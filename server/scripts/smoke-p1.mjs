/**
 * P1 排位匹配协议级冒烟测试（自包含：会自行拉起一个隔离的服务端实例）。
 *
 * 覆盖：
 *   A. 匹配成功：入队 -> 两份 match.found 指向同一局 -> 座位红/黑 -> 快照 ranked + 带评分
 *   B. 结算：认输后双方收到 rating.update，零和（+16 / -16），并落盘到 JSON 与 profile.get 可读
 *   C. 分段限制：2000 分与 1200 分分差超区间不匹配；随后两个 1200 分就近配对
 *   D. 取消匹配：match.leave 后确实出队，不会误配
 *   E. 排行榜：leaderboard.get 返回按分数降序的榜单，limit 生效，0 场档案被过滤
 *
 * 运行：node server/scripts/smoke-p1.mjs
 * 说明：脚本用独立端口(默认 8799)与临时 RATINGS_FILE，不污染正在运行的开发服务端。
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

const PORT = Number(process.env.SMOKE_PORT ?? 8799);
const URL = `ws://localhost:${PORT}`;

const tmp = mkdtempSync(join(tmpdir(), 'cc-smoke-p1-'));
const seedFile = join(tmp, 'ratings.json');
// 预置一个高分玩家（用于验证分段区间限制）+ 一个 0 场档案（用于验证排行榜过滤）
writeFileSync(
  seedFile,
  JSON.stringify([
    { playerId: 'seed_far', name: '高手', rating: 2000, games: 50, wins: 45, losses: 5, draws: 0, updatedAt: Date.now() },
    { playerId: 'seed_idle', name: '空场访客', rating: 2400, games: 0, wins: 0, losses: 0, draws: 0, updatedAt: Date.now() },
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

  none(type, ms = 2500) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(!this.msgs.some((m) => m.t === type)), ms);
    });
  }

  close() {
    this.ws?.close();
  }
}

function launchServer() {
  const child = spawn(process.execPath, [tsxCli, 'src/index.ts'], {
    cwd: serverDir,
    env: { ...process.env, PORT: String(PORT), RATINGS_FILE: seedFile, RECONNECT_GRACE_MS: '3000' },
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
      if (res.ok) return true;
    } catch {
      /* 尚未监听，稍后重试 */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function scenarioMatchAndSettle() {
  console.log('场景 A/B：匹配成功 + 排位结算');
  const A = new Client('A');
  const B = new Client('B');
  await A.connect();
  await B.connect();
  const pa = rid('pa');
  const pb = rid('pb');

  A.send({ t: 'match.join', playerId: pa, name: '甲' });
  const qa = await A.wait('match.queued');
  ok(qa.rating === 1200 && qa.waiting === 1, '甲 入队收到 match.queued(rating=1200, waiting=1)', JSON.stringify(qa));

  B.send({ t: 'match.join', playerId: pb, name: '乙' });
  const [fa, fb] = await Promise.all([A.wait('match.found'), B.wait('match.found')]);
  ok(fa.gameId === fb.gameId, '双方 match.found 指向同一局', `A=${fa.gameId} B=${fb.gameId}`);
  ok(fa.youAre === 'red' && fb.youAre === 'black', '先入座者执红，后到者执黑');
  ok(fa.opponent.name === '乙' && fa.opponent.rating === 1200, '甲 看到对手 乙(1200)', JSON.stringify(fa.opponent));

  const sa = await A.wait('game.state');
  const sb = await B.wait('game.state');
  ok(sa.ranked === true && sb.ranked === true, '排位局快照 ranked=true');
  ok(sa.players.length === 2 && sa.players.every((p) => p.rating === 1200), '快照玩家携带 1200 分');

  // 甲（红方）认输 -> 黑方胜
  A.send({ t: 'game.resign', gameId: fa.gameId });
  const ova = await A.wait('game.over');
  await B.wait('game.over');
  ok(ova.winner === '黑方' && ova.reason === 'resign', 'game.over = 黑方(resign)', JSON.stringify(ova));

  const rua = await A.wait('rating.update');
  const rub = await B.wait('rating.update');
  ok(rua.result === 'loss' && rub.result === 'win', '结算：甲负 / 乙胜');
  ok(rua.you.before === 1200 && rua.you.rating === 1184 && rua.you.delta === -16, '甲 1200 -> 1184 (-16)', JSON.stringify(rua.you));
  ok(rub.you.rating === 1216 && rub.you.delta === 16, '乙 1200 -> 1216 (+16)', JSON.stringify(rub.you));
  ok(rua.you.delta === -rub.you.delta, '零和：双方 delta 互为相反数');

  const C = new Client('C');
  await C.connect();
  C.send({ t: 'profile.get', playerId: pa });
  const prof = await C.wait('profile');
  ok(prof.rating === 1184 && prof.losses === 1 && prof.games === 1, 'profile.get 读到 1184 分 / 1 负', JSON.stringify(prof));

  const persisted = JSON.parse(readFileSync(seedFile, 'utf8'));
  const recA = persisted.find((r) => r.playerId === pa);
  ok(recA && recA.rating === 1184, '结算已落盘到 ratings.json');

  A.close();
  B.close();
  C.close();
}

async function scenarioBand() {
  console.log('场景 C：分段区间限制');
  const D = new Client('D');
  const E = new Client('E');
  const F = new Client('F');
  await D.connect();
  await E.connect();
  await F.connect();

  // D = 2000 分（预置），E = 1200 分，分差 800 > 初始区间 100
  D.send({ t: 'match.join', playerId: 'seed_far', name: '高手' });
  await D.wait('match.queued');
  E.send({ t: 'match.join', playerId: rid('pd'), name: '丁' });
  await E.wait('match.queued');

  const noMatch = await Promise.all([D.none('match.found', 2500), E.none('match.found', 2500)]);
  ok(noMatch[0] && noMatch[1], '2000 分与 1200 分分差超出区间，未匹配');

  // F = 1200 分（与丁同分），应与先入队的丁配对，而非与高手
  F.send({ t: 'match.join', playerId: rid('pf'), name: '戊' });
  const [fe, ff] = await Promise.all([E.wait('match.found', 5000), F.wait('match.found', 5000)]);
  ok(fe.gameId === ff.gameId, '丁 + 戊 同分就近配对成功');
  ok(!D.msgs.some((m) => m.t === 'match.found'), '高手仍未匹配（分数差过大）');

  F.send({ t: 'game.resign', gameId: fe.gameId });
  await E.wait('game.over', 4000).catch(() => {});

  D.close();
  E.close();
  F.close();
}

async function scenarioCancel() {
  console.log('场景 D：取消匹配');
  const G = new Client('G');
  const H = new Client('H');
  await G.connect();
  await H.connect();

  G.send({ t: 'match.join', playerId: rid('pg'), name: '庚' });
  await G.wait('match.queued');
  G.send({ t: 'match.leave' });
  await new Promise((r) => setTimeout(r, 300));

  H.send({ t: 'match.join', playerId: rid('ph'), name: '辛' });
  const qh = await H.wait('match.queued');
  ok(qh.waiting === 1, '取消后队列回到 1 人（庚已出队）', JSON.stringify(qh));

  const none = await Promise.all([G.none('match.found', 2000), H.none('match.found', 2000)]);
  ok(none[0] && none[1], '庚已离开队列，未与辛误配');

  G.close();
  H.close();
}

async function scenarioLeaderboard() {
  console.log('场景 E：排行榜');
  const K = new Client('K');
  const K2 = new Client('K2');
  await K.connect();
  await K2.connect();

  K.send({ t: 'leaderboard.get' });
  const lb = await K.wait('leaderboard');
  ok(Array.isArray(lb.list) && lb.list.length >= 3, 'leaderboard.get 返回榜单列表', `len=${lb.list.length}`);
  ok(lb.list.every((r) => typeof r.rating === 'number' && typeof r.games === 'number'), '条目含 rating/games 字段');
  let desc = true;
  for (let i = 1; i < lb.list.length; i += 1) {
    if (lb.list[i - 1].rating < lb.list[i].rating) desc = false;
  }
  ok(desc, '按分数降序排列', JSON.stringify(lb.list.map((r) => r.rating)));
  ok(lb.list[0].name === '高手' && lb.list[0].rating === 2000, '种子高分玩家居首(2000)', JSON.stringify(lb.list[0]));
  const names = lb.list.map((r) => r.name);
  ok(names.includes('乙') && names.includes('甲'), '已结算的 甲/乙 出现在榜单', JSON.stringify(names));
  ok(lb.list.every((r) => r.games > 0), '未下过棋的 0 场档案被过滤掉', JSON.stringify(lb.list.map((r) => `${r.name}:${r.games}`)));
  ok(!names.includes('空场访客'), '种子 0 场档案（2400 分）未上榜', JSON.stringify(names));

  K2.send({ t: 'leaderboard.get', limit: 1 });
  const lb1 = await K2.wait('leaderboard');
  ok(lb1.list.length === 1, 'limit 生效（limit=1 -> 1 条）', `len=${lb1.list.length}`);

  K.close();
  K2.close();
}

async function main() {
  console.log(`P1 排位匹配冒烟测试  (port=${PORT})`);
  const server = launchServer();
  try {
    const healthy = await waitHealthy();
    if (!healthy) {
      console.log('  ? 服务端未能在超时内就绪');
      fail += 1;
      return;
    }
    await scenarioMatchAndSettle();
    await scenarioBand();
    await scenarioCancel();
    await scenarioLeaderboard();
  } catch (err) {
    fail += 1;
    console.log(`  ? 未捕获异常：${err.message}`);
  } finally {
    server.kill();
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
