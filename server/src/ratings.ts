import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { INITIAL_RATING, updateRatings } from './rating.js';

/** 一个玩家的排位档案 */
export interface RatingRecord {
  playerId: string;
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  updatedAt: number;
}

/** 落盘路径：默认 server/data/ratings.json，可用 RATINGS_FILE 覆盖（便于测试隔离） */
const DEFAULT_FILE = process.env.RATINGS_FILE ?? resolve(process.cwd(), 'data', 'ratings.json');

/**
 * 评分仓库：内存 Map + JSON 文件持久化。
 * 读取在启动时同步完成；写入在每次结算后同步落盘（结算频率极低，无需异步队列）。
 */
export class RatingsStore {
  private readonly file: string;
  private map = new Map<string, RatingRecord>();

  constructor(file: string = DEFAULT_FILE) {
    this.file = file;
    this.load();
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return;
      const raw = readFileSync(this.file, 'utf8');
      const arr = JSON.parse(raw) as RatingRecord[];
      for (const r of arr) {
        if (r && typeof r.playerId === 'string') this.map.set(r.playerId, r);
      }
    } catch (err) {
      console.warn('[ratings] 读取失败，按空表启动:', (err as Error).message);
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify([...this.map.values()], null, 2), 'utf8');
    } catch (err) {
      console.warn('[ratings] 落盘失败:', (err as Error).message);
    }
  }

  /** 取档案（不存在则新建；传入 name 可同步昵称）。playerId 为空表示游客，返回一次性档案。 */
  get(playerId: string, name?: string): RatingRecord {
    const clean = name?.trim();
    if (!playerId) {
      return {
        playerId: '',
        name: clean || '游客',
        rating: INITIAL_RATING,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        updatedAt: Date.now(),
      };
    }
    let rec = this.map.get(playerId);
    if (!rec) {
      rec = {
        playerId,
        name: clean || '无名棋手',
        rating: INITIAL_RATING,
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        updatedAt: Date.now(),
      };
      this.map.set(playerId, rec);
      this.save();
    } else if (clean && clean !== rec.name) {
      rec.name = clean;
      rec.updatedAt = Date.now();
      this.save();
    }
    return rec;
  }

  /** 结算一局：scoreA 为 A 的得分（1/0.5/0）。返回双方最新档案。 */
  settle(playerIdA: string, playerIdB: string, scoreA: number): { a: RatingRecord; b: RatingRecord } {
    const a = this.get(playerIdA);
    const b = this.get(playerIdB);
    const next = updateRatings(a.rating, b.rating, scoreA);
    a.rating = next.a;
    b.rating = next.b;
    a.games += 1;
    b.games += 1;
    if (scoreA === 1) {
      a.wins += 1;
      b.losses += 1;
    } else if (scoreA === 0) {
      a.losses += 1;
      b.wins += 1;
    } else {
      a.draws += 1;
      b.draws += 1;
    }
    a.updatedAt = Date.now();
    b.updatedAt = Date.now();
    this.save();
    return { a, b };
  }

  /**
   * 排行榜：按分数降序取前 limit 名（默认 20，钳制在 1..100）。同分按昵称升序，保证顺序稳定。
   * 只收录有完赛记录的档案 —— 任何访客打开页面都会自动建档（0 场），不应占据榜单。
   */
  top(limit = 20): RatingRecord[] {
    const n = Math.min(Math.max(Math.floor(limit) || 20, 1), 100);
    return [...this.map.values()]
      .filter((r) => r.games > 0)
      .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name))
      .slice(0, n);
  }

  /**
   * 把游客档案迁移到账号：注册时调用，让游客期间攒下的分数跟着账号走。
   * 仅当来源有战绩、目标尚无战绩时迁移，避免覆盖已有分数。
   */
  transfer(fromId: unknown, toId: unknown): boolean {
    const from = typeof fromId === 'string' ? fromId.trim() : '';
    const to = typeof toId === 'string' ? toId.trim() : '';
    if (!from || !to || from === to) return false;
    const src = this.map.get(from);
    if (!src || src.games <= 0) return false;
    const dst = this.map.get(to);
    if (dst && dst.games > 0) return false;
    this.map.delete(from);
    this.map.set(to, { ...src, playerId: to, updatedAt: Date.now() });
    this.save();
    return true;
  }
}

export const ratings = new RatingsStore();
