import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { Game, type Player } from './room.js';
import type { PlayerInfo } from './protocol.js';

export interface JoinResult {
  game: Game;
  player: Player | null;
}

/** 断线宽限期：超过该时长未回连，则对局中判负 / 等待中释放座位 */
const GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 30000);

/**
 * 内存房间仓库。P0 阶段不落库：进程重启即清空。
 * 房间生命周期：`room.join` 创建 -> 两人入座 -> 对局进行 -> 结束后可复用房间号再开新局。
 */
export class Store {
  private rooms = new Map<string, Game>();
  private games = new Map<string, Game>();
  /** 与 Game.graceMs 同源的宽限期时长，供网关调度超时定时器 */
  readonly graceMs = GRACE_MS;

  /** 加入（或创建）房间。若房间已满/已结束，则复用房间号另起一局。 */
  joinRoom(roomId: string, ws: WebSocket, name?: string): JoinResult {
    let game = this.rooms.get(roomId);
    if (!game || game.isFull || game.status === 'over') {
      game = new Game(roomId, GRACE_MS);
      this.rooms.set(roomId, game);
      this.games.set(game.gameId, game);
    }
    const player = game.seat(ws, name);
    return { game, player };
  }

  getGame(gameId: string): Game | undefined {
    return this.games.get(gameId);
  }

  /**
   * 创建一局排位对局（随机匹配）。不挂到房间号上，roomId 用合成值仅作展示。
   * 座位由 Matchmaker 用 game.seat 直接分配。
   */
  createRanked(): Game {
    const game = new Game(`ranked-${randomUUID().slice(0, 6)}`, GRACE_MS);
    game.ranked = true;
    this.games.set(game.gameId, game);
    return game;
  }

  /** 反查：该 socket 当前所在的对局 */
  findGameBySocket(ws: WebSocket): Game | undefined {
    for (const game of this.games.values()) {
      if (game.playerBySocket(ws)) return game;
    }
    return undefined;
  }

  /** 对局结束或已无座位、且所有连接均离线时回收，避免内存泄漏。 */
  reap(game: Game): void {
    const infos: PlayerInfo[] = game.playerList();
    const done = game.status === 'over' || game.playerCount === 0;
    if (done && infos.every((p) => !p.connected)) {
      this.games.delete(game.gameId);
      const cur = this.rooms.get(game.roomId);
      if (cur === game) this.rooms.delete(game.roomId);
    }
  }
}

export const store = new Store();
