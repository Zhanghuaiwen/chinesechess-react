/**
 * P4 账号系统协议级冒烟测试（自包含：自行拉起隔离的服务端实例）。
 *
 * 覆盖：
 *   A. 游客模式仍可用：不带令牌也能查档案 / 进匹配队列
 *   B. 注册：返回令牌与固定 playerId，并把游客战绩迁入新账号
 *   C. 注册校验：用户名重复（大小写不敏感）、密码过短
 *   D. 登录：错误密码 -> bad_credentials；正确密码 -> 同一 playerId
 *   E. 令牌权威：带令牌时忽略客户端自报 playerId，防止冒用他人分数
 *   F. auth.me：有效令牌恢复登录态；伪造令牌 -> invalid_token
 *   G. 退出登录：令牌立即失效
 *   H. 落盘安全：accounts.json 不保存明文密码
 *
 * 运行：node server/scripts/smoke-auth.mjs
 * 说明：独立端口(默认 8801) + 临时数据文件，不污染开发服务端。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, '..');
const tsxCli = join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const PORT = Number(process.env.SMOKE_PORT ?? 8801);
const URL = `ws://localhost:${PORT}`;

const tmp = mkdtempSync(join(tmpdir(), 'cc-smoke-auth-'));
const ratingsFile = join(tmp, 'ratings.json');
const accountsFile = join(tmp, 'accounts.json');

// 预置一个有战绩的游客，用于验证「注册时游客战绩并入账号」
writeFileSync(
  ratingsFile,
  JSON.stringify([
    { playerId: 'guest_rich', name: '游客甲', rating: 1500, games: 5, wins: 4, losses: 1, draws: 0, updatedAt: Date.now() },
  ]),
  'utf8',
);

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${label}`);
  } else {
    fail += 1;
    console.log(`  \u2717 ${label}${extra ? `  -> ${extra}` : ''}`);
  }
};
const rid = (p) => `${p}_${Math.random().toString(36).slice(2, 10)}`;

class Client {
  constructor(tag) {
    this.tag = tag;
    this.msgs = [];
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(URL);
      ws.on('open', () => {
        this.ws = ws;
        resolve();
      });
      ws.on('error', reject);
      ws.on('message', (data) => {
        let m;
        try {
          m = JSON.parse(data.toString());
        } catch {
          return;
        }
        this.msgs.push(m);
      });
    });
  }

  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }

  clear() {
    this.msgs = [];
  }

  wait(type, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = this.msgs.find((m) => m.t === type);
        if (hit) {
          clearInterval(iv);
          resolve(hit);
        } else if (Date.now() - t0 > timeout) {
          clearInterval(iv);
          reject(new Error(`[${this.tag}] 等待 ${type} 超时；已收: ${this.msgs.map((x) => x.t).join(',') || '无'}`));
        }
      }, 25);
    });
  }

  close() {
    this.ws?.close();
  }
}

function launchServer() {
  const child = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(PORT),
      RATINGS_FILE: ratingsFile,
      ACCOUNTS_FILE: accountsFile,
      RECONNECT_GRACE_MS: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

async function waitHealthy(maxMs = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('服务端未在预期时间内就绪');
}

/** A. 游客模式不受登录影响 */
async function scenarioGuest() {
  console.log('场景 A：游客模式');
  const g = new Client('guest');
  await g.connect();
  const pid = rid('guest');
  g.send({ t: 'profile.get', playerId: pid });
  const prof = await g.wait('profile');
  ok(prof.playerId === pid && prof.rating === 1200, '游客可查档案（1200 分）', JSON.stringify(prof));
  g.clear();
  g.send({ t: 'match.join', playerId: pid, name: '路人' });
  const q = await g.wait('match.queued');
  ok(q.rating === 1200, '游客可进匹配队列', JSON.stringify(q));
  g.send({ t: 'match.leave' });
  g.close();
}

/** B-H. 账号全流程 */
async function scenarioAccount() {
  console.log('场景 B：注册 + 游客战绩迁移');
  const c = new Client('account');
  await c.connect();
  c.send({ t: 'auth.register', username: 'Alice', password: 'secret123', name: '爱丽丝', guestId: 'guest_rich' });
  const reg = await c.wait('auth.ok');
  ok(!!reg.token && reg.token.length >= 32, '注册成功并下发令牌');
  ok(reg.user.username === 'alice', '用户名规范化为小写', JSON.stringify(reg.user));
  ok(reg.user.name === '爱丽丝', '展示名取注册昵称', JSON.stringify(reg.user));
  ok(/^[0-9a-f-]{36}$/.test(reg.user.playerId), '账号获得固定 playerId(UUID)', reg.user.playerId);
  const token = reg.token;
  const accountId = reg.user.playerId;

  c.clear();
  c.send({ t: 'profile.get', playerId: accountId, token });
  const prof = await c.wait('profile');
  ok(prof.rating === 1500 && prof.games === 5, '游客战绩(1500 分/5 局)已迁入账号', JSON.stringify(prof));
  ok(prof.name === '爱丽丝', '档案名称为账号展示名', prof.name);

  c.clear();
  c.send({ t: 'leaderboard.get' });
  const lb = await c.wait('leaderboard');
  const names = lb.list.map((r) => r.name);
  ok(names.includes('爱丽丝') && !names.includes('游客甲'), '榜单只剩账号记录，游客旧档已迁移', JSON.stringify(names));

  console.log('场景 C：注册校验');
  c.clear();
  c.send({ t: 'auth.register', username: 'ALICE', password: 'another1' });
  const dup = await c.wait('auth.error');
  ok(dup.code === 'username_taken', '用户名重复（大小写不敏感）被拒', JSON.stringify(dup));

  c.clear();
  c.send({ t: 'auth.register', username: 'bob', password: '123' });
  const weak = await c.wait('auth.error');
  ok(weak.code === 'bad_password', '密码过短被拒', JSON.stringify(weak));

  console.log('场景 D：登录');
  c.clear();
  c.send({ t: 'auth.login', username: 'alice', password: 'wrong-pass' });
  const bad = await c.wait('auth.error');
  ok(bad.code === 'bad_credentials', '错误密码 -> bad_credentials', JSON.stringify(bad));

  c.clear();
  c.send({ t: 'auth.login', username: 'alice', password: 'secret123' });
  const login = await c.wait('auth.ok');
  ok(login.user.playerId === accountId, '登录返回同一个 playerId（分数可找回）', login.user.playerId);
  ok(login.token !== token, '每次登录签发新令牌');
  const token2 = login.token;

  console.log('场景 E：令牌权威身份');
  c.clear();
  c.send({ t: 'profile.get', playerId: 'spoofed_id', token: token2 });
  const authProf = await c.wait('profile');
  ok(authProf.playerId === accountId, '带令牌时忽略自报 playerId，防冒用', authProf.playerId);

  c.clear();
  c.send({ t: 'match.join', playerId: 'spoofed_id', name: '假名', token: token2 });
  const q = await c.wait('match.queued');
  ok(q.rating === 1500, '匹配按账号分数入队（1500）', JSON.stringify(q));
  c.send({ t: 'match.leave' });

  console.log('场景 F：auth.me');
  c.clear();
  c.send({ t: 'auth.me', token: token2 });
  const me = await c.wait('auth.ok');
  ok(me.user.playerId === accountId, '有效令牌可恢复登录态', JSON.stringify(me.user));

  c.clear();
  c.send({ t: 'auth.me', token: 'deadbeef' });
  const invalid = await c.wait('auth.error');
  ok(invalid.code === 'invalid_token', '伪造令牌 -> invalid_token', JSON.stringify(invalid));

  console.log('场景 G：退出登录');
  c.clear();
  c.send({ t: 'auth.logout', token: token2 });
  await c.wait('auth.loggedOut');
  c.clear();
  c.send({ t: 'auth.me', token: token2 });
  const afterLogout = await c.wait('auth.error');
  ok(afterLogout.code === 'invalid_token', '退出后该令牌立即失效', JSON.stringify(afterLogout));

  c.close();
}

async function main() {
  console.log(`P4 账号系统冒烟测试  (port=${PORT})`);
  const server = launchServer();
  try {
    await waitHealthy();
    await scenarioGuest();
    await scenarioAccount();

    console.log('场景 H：落盘安全');
    const raw = readFileSync(accountsFile, 'utf8');
    ok(!raw.includes('secret123'), 'accounts.json 不含明文密码');
    const parsed = JSON.parse(raw);
    const acc = parsed.accounts?.[0];
    ok(!!acc?.salt && !!acc?.hash && acc.hash.length === 128, '密码以 scrypt 派生值 + 盐保存', acc ? `hashLen=${acc.hash.length}` : '无记录');
    ok(!JSON.stringify(parsed.sessions ?? []).includes('"token":"'), '令牌只存摘要，不存明文');
  } catch (err) {
    fail += 1;
    console.error('测试异常:', err);
  } finally {
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
