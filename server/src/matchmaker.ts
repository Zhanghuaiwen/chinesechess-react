import type { WebSocket } from 'ws';
import { store } from './store.js';
import { send, type Game } from './room.js';
import { ratings } from './ratings.js';

/** 匹配分段起始区间（±分）与放宽节奏 */
const BASE_BAND = 100;
const WIDEN_EVERY_MS = 5000;
const WIDEN_STEP = 100;
const MAX_BAND = 800;
/** 等待超过此时长则不再看分，直接与最近的人开局 */
const HARD_WAIT_MS = 30000;

interface Entry {
  ws: WebSocket;
  playerId: string;
  name: string;
  rating: number;
  joinedAt: number;
  /** 上一次已通知的分段区间，用于避免重复推送 */
  lastBand: number;
}

/**
 * 随机匹配队列（P1）。
 * 策略：先按分数就近匹配，区间随时间放宽（100 -> +100/5s -> 上限 800）；
 * 等待超过 30s 则忽略分差直接配对，避免长队饿死。
 */
export class Matchmaker {
  private queue: Entry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  /** 启动周期任务：每秒重算一次匹配（处理等待放宽带来的新机会）。 */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref?.();
  }

  /** 入队。同一 socket 重复入队会先移除旧条目。 */
  join(ws: WebSocket, playerId: string, name?: string): void {
    this.remove(ws);
    const rec = ratings.get(playerId, name);
    const entry: Entry = {
      ws,
      playerId,
      name: rec.name,
      rating: rec.rating,
      joinedAt: Date.now(),
      lastBand: 0,
    };
    this.queue.push(entry);
    this.notify(entry);
    this.tryMatch();
  }

  /** 出队（取消匹配或断线）。返回是否命中队列。 */
  remove(ws: WebSocket): boolean {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.ws !== ws);
    return this.queue.length !== before;
  }

  get waitingCount(): number {
    return this.queue.length;
  }

  private bandOf(e: Entry, now = Date.now()): number {
    if (now - e.joinedAt >= HARD_WAIT_MS) return Number.MAX_SAFE_INTEGER;
    const steps = Math.floor((now - e.joinedAt) / WIDEN_EVERY_MS);
    return Math.min(MAX_BAND, BASE_BAND + steps * WIDEN_STEP);
  }

  private notify(e: Entry): void {
    const band = this.bandOf(e);
    e.lastBand = band;
    send(e.ws, {
      t: 'match.queued',
      rating: e.rating,
      waiting: this.queue.length,
      band: band === Number.MAX_SAFE_INTEGER ? null : band,
    });
  }

  private tick(): void {
    const now = Date.now();
    // 区间放宽后主动推送最新排队状态
    for (const e of this.queue) {
      const band = this.bandOf(e, now);
      if (band !== e.lastBand) this.notify(e);
    }
    this.tryMatch();
  }

  /** 单轮撮合：优先让等待最久者匹配分数最接近的对手。 */
  private tryMatch(): void {
    if (this.queue.length < 2) return;
    this.queue.sort((x, y) => x.joinedAt - y.joinedAt);

    for (let i = 0; i < this.queue.length; i += 1) {
      const a = this.queue[i];
      const bandA = this.bandOf(a);
      let bestIndex = -1;
      let bestDiff = Number.POSITIVE_INFINITY;

      for (let j = 0; j < this.queue.length; j += 1) {
        if (j === i) continue;
        const b = this.queue[j];
        if (a.playerId && a.playerId === b.playerId) continue; // 不与本人匹配
        const diff = Math.abs(a.rating - b.rating);
        if (diff <= Math.min(bandA, this.bandOf(b)) && diff < bestDiff) {
          bestIndex = j;
          bestDiff = diff;
        }
      }

      if (bestIndex >= 0) {
        const b = this.queue[bestIndex];
        const hi = Math.max(i, bestIndex);
        const lo = Math.min(i, bestIndex);
        this.queue.splice(hi, 1);
        this.queue.splice(lo, 1);
        this.startRanked(a, b);
        this.tryMatch(); // 继续撮合剩余队列
        return;
      }
    }
  }

  private startRanked(a: Entry, b: Entry): void {
    const game = store.createRanked();
    const pa = game.seat(a.ws, a.name, { playerId: a.playerId, rating: a.rating });
    const pb = game.seat(b.ws, b.name, { playerId: b.playerId, rating: b.rating });
    game.onEnd = (g) => this.settle(g);

    if (pa) {
      send(a.ws, {
        t: 'match.found',
        gameId: game.gameId,
        roomId: game.roomId,
        youAre: pa.color,
        sessionId: pa.sessionId,
        players: game.playerList(),
        opponent: { name: pb?.name ?? '对手', rating: pb?.rating ?? 0 },
      });
    }
    if (pb) {
      send(b.ws, {
        t: 'match.found',
        gameId: game.gameId,
        roomId: game.roomId,
        youAre: pb.color,
        sessionId: pb.sessionId,
        players: game.playerList(),
        opponent: { name: pa?.name ?? '对手', rating: pa?.rating ?? 0 },
      });
    }
    game.broadcastSnapshot();
  }

  /** 对局结束结算：按胜负更新双方 ELO，并各自下发评分变化。 */
  private settle(game: Game): void {
    const seats = game.seats.filter((p) => p.playerId);
    if (seats.length !== 2) return;
    const a = seats[0];
    const b = seats[1];
    const beforeA = a.rating;
    const beforeB = b.rating;
    const wc = game.winnerColor;
    const scoreA = wc === null ? 0.5 : a.color === wc ? 1 : 0;

    const settled = ratings.settle(a.playerId, b.playerId, scoreA);
    a.rating = settled.a.rating;
    b.rating = settled.b.rating;

    const resA: 'win' | 'loss' | 'draw' = scoreA === 1 ? 'win' : scoreA === 0 ? 'loss' : 'draw';
    const resB: 'win' | 'loss' | 'draw' = scoreA === 1 ? 'loss' : scoreA === 0 ? 'win' : 'draw';

    if (a.ws) {
      send(a.ws, {
        t: 'rating.update',
        gameId: game.gameId,
        result: resA,
        you: { rating: a.rating, before: beforeA, delta: a.rating - beforeA },
        opponent: { name: b.name, rating: b.rating, before: beforeB },
      });
    }
    if (b.ws) {
      send(b.ws, {
        t: 'rating.update',
        gameId: game.gameId,
        result: resB,
        you: { rating: b.rating, before: beforeB, delta: b.rating - beforeB },
        opponent: { name: a.name, rating: a.rating, before: beforeA },
      });
    }
  }
}

export const matchmaker = new Matchmaker();
