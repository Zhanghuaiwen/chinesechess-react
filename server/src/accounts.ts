import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** 账号记录：密码只保存 scrypt 派生值 + 盐，永不保存明文 */
export interface AccountRecord {
  /** 排位分的归属键：注册时生成，此后固定不变 */
  playerId: string;
  /** 规范化后的小写用户名，作为唯一键 */
  username: string;
  /** 展示名（排行榜/对局内显示） */
  displayName: string;
  salt: string;
  hash: string;
  createdAt: number;
}

interface SessionRecord {
  tokenHash: string;
  playerId: string;
  expiresAt: number;
}

interface StoreFile {
  accounts: AccountRecord[];
  sessions: SessionRecord[];
}

/** 落盘路径：默认 server/data/accounts.json，可用 ACCOUNTS_FILE 覆盖（便于测试隔离） */
const DEFAULT_FILE = process.env.ACCOUNTS_FILE ?? resolve(process.cwd(), 'data', 'accounts.json');
/** 登录令牌有效期：30 天 */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 用户名：2-20 位字母/数字/下划线/中文 */
const USERNAME_RE = /^[\w\u4e00-\u9fa5]{2,20}$/;

export type AuthResult =
  | { ok: true; token: string; account: AccountRecord }
  | { ok: false; code: string; msg: string };

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 账号仓库：内存 Map + JSON 文件持久化。
 * 不引入任何第三方依赖：密码用 node:crypto 的 scrypt 加盐派生，令牌只存 sha256 摘要。
 */
export class AccountsStore {
  private file: string;
  private accounts = new Map<string, AccountRecord>(); // key: username(lower)
  private sessions = new Map<string, SessionRecord>(); // key: tokenHash

  constructor(file: string = DEFAULT_FILE) {
    this.file = file;
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoreFile>;
      for (const a of raw.accounts ?? []) this.accounts.set(a.username, a);
      const now = Date.now();
      for (const s of raw.sessions ?? []) {
        if (s.expiresAt > now) this.sessions.set(s.tokenHash, s);
      }
    } catch (err) {
      console.warn('[accounts] 读取失败，按空表启动:', (err as Error).message);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const data: StoreFile = {
        accounts: [...this.accounts.values()],
        sessions: [...this.sessions.values()],
      };
      writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[accounts] 写入失败:', (err as Error).message);
    }
  }

  /** 注册成功后直接签发令牌。 */
  register(username: unknown, password: unknown, name?: unknown): AuthResult {
    const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const p = typeof password === 'string' ? password : '';
    if (!USERNAME_RE.test(u)) {
      return { ok: false, code: 'bad_username', msg: '用户名需 2-20 位字母/数字/下划线/中文' };
    }
    if (p.length < 6 || p.length > 64) {
      return { ok: false, code: 'bad_password', msg: '密码长度需 6-64 位' };
    }
    if (this.accounts.has(u)) {
      return { ok: false, code: 'username_taken', msg: '该用户名已被注册' };
    }

    const salt = randomBytes(16).toString('hex');
    const display = typeof name === 'string' && name.trim() ? name.trim().slice(0, 12) : u;
    const account: AccountRecord = {
      playerId: randomUUID(),
      username: u,
      displayName: display,
      salt,
      hash: hashPassword(p, salt),
      createdAt: Date.now(),
    };
    this.accounts.set(u, account);
    const token = this.issue(account.playerId);
    this.save();
    return { ok: true, token, account };
  }

  login(username: unknown, password: unknown): AuthResult {
    const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
    const p = typeof password === 'string' ? password : '';
    const account = this.accounts.get(u);
    if (!account) return { ok: false, code: 'bad_credentials', msg: '用户名或密码错误' };

    const expected = Buffer.from(account.hash, 'hex');
    const actual = Buffer.from(hashPassword(p, account.salt), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { ok: false, code: 'bad_credentials', msg: '用户名或密码错误' };
    }
    const token = this.issue(account.playerId);
    this.save();
    return { ok: true, token, account };
  }

  /** 校验令牌：有效返回账号，过期/无效返回 null（过期令牌顺手清理）。 */
  verify(token: unknown): AccountRecord | null {
    if (typeof token !== 'string' || !token) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      this.save();
      return null;
    }
    for (const a of this.accounts.values()) {
      if (a.playerId === session.playerId) return a;
    }
    return null;
  }

  /** 注销：只让当前令牌失效，其他设备上的登录不受影响。 */
  logout(token: unknown): void {
    if (typeof token !== 'string' || !token) return;
    if (this.sessions.delete(hashToken(token))) this.save();
  }

  private issue(playerId: string): string {
    const token = randomBytes(32).toString('hex');
    const key = hashToken(token);
    this.sessions.set(key, { tokenHash: key, playerId, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }
}

export const accounts = new AccountsStore();
