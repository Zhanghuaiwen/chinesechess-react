import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  initBoard,
  getSafeMoves,
  makeMove,
  isInCheck,
  hasLegalMove,
  generateNotation,
  boardKey,
} from '../../shared/gameLogic.js';
import type {
  Cell,
  Color,
  GameSnapshot,
  MoveRecord,
  OfflineInfo,
  PlayerInfo,
  RejectReason,
  ServerMessage,
  Status,
} from './protocol.js';

type Board = any[][];

const colorName = (c: Color): string => (c === 'red' ? '红方' : '黑方');
const other = (c: Color): Color => (c === 'red' ? 'black' : 'red');

/** 房间内的一个座位。ws 为 null 表示断线但座位仍被保留（宽限期内等待回连）。 */
export interface Player {
  id: string;
  /** 重连凭据：断线后客户端凭它 reclaim 该座位 */
  sessionId: string;
  /** 排位身份（客户端 localStorage 匿名 ID）；休闲房号局为空串 */
  playerId: string;
  /** 当前排位分（快照展示用，结算后由 Matchmaker 更新） */
  rating: number;
  name: string;
  color: Color;
  ws: WebSocket | null;
  /** 宽限期截止时间戳；null 表示在线或无宽限期 */
  offlineUntil: number | null;
  /** 宽限期定时器句柄 */
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export interface MoveOutcome {
  ok: true;
  accepted: Extract<ServerMessage, { t: 'game.move.accepted' }>;
  gameOver: Extract<ServerMessage, { t: 'game.over' }> | null;
}

export interface MoveFailure {
  ok: false;
  reason: RejectReason;
}

/**
 * 一局对战：持有唯一权威状态（棋盘/行棋方/序号/历史）。
 * 所有走子都必须经由 applyMove 校验，客户端提交的只是「意图」。
 */
export class Game {
  readonly gameId: string;
  readonly roomId: string;

  private board: Board;
  private turn: Color = 'red';
  private moves: MoveRecord[] = [];
  private seq = 0;
  status: Status = 'waiting';
  private winner: string | null = null;
  private reason: string | null = null;
  private players: Player[] = [];
  /** 局面重复计数：用于三次重复局面判和 */
  private repetitions = new Map<string, number>();
  /** 断线宽限期时长（ms）：由 Store 注入，快照与网关定时器共用同一个值 */
  readonly graceMs: number;
  /** 排位局标记：随机匹配创建的对局为 true，结算时据此更新 ELO */
  ranked = false;
  /** 胜方颜色（null 表示和棋）；ELO 结算需要按颜色而非昵称判定 */
  winnerColor: Color | null = null;
  /** 终局回调（由 Matchmaker 注入用于排位结算）；休闲局为 null */
  onEnd: ((game: Game) => void) | null = null;

  constructor(roomId: string, graceMs = 30000) {
    this.roomId = roomId;
    this.gameId = `g_${randomUUID().slice(0, 8)}`;
    this.graceMs = graceMs;
    this.board = initBoard();
    this.repetitions.set(boardKey(this.board, this.turn), 1);
  }

  get isFull(): boolean {
    return this.players.length >= 2;
  }

  get playerCount(): number {
    return this.players.length;
  }

  /** 当前权威版本号（用于拒绝时回带，便于客户端重新对齐） */
  get currentSeq(): number {
    return this.seq;
  }

  /** 入座。返回分配到的颜色；满员或已开局返回 null。identity 用于排位局绑定玩家身份与分数。 */
  seat(
    ws: WebSocket,
    name?: string,
    identity?: { playerId?: string; rating?: number },
  ): Player | null {
    if (this.isFull) return null;
    if (this.status === 'over') return null;
    const color: Color = this.players.length === 0 ? 'red' : 'black';
    const player: Player = {
      id: `u_${randomUUID().slice(0, 8)}`,
      sessionId: randomUUID(),
      playerId: identity?.playerId ?? '',
      rating: identity?.rating ?? 1200,
      name: name?.trim() || colorName(color),
      color,
      ws,
      offlineUntil: null,
      graceTimer: null,
    };
    this.players.push(player);
    if (this.isFull) this.status = 'playing';
    return player;
  }

  /** 全部座位（只读视图，供结算/网关按身份访问）。 */
  get seats(): readonly Player[] {
    return this.players;
  }

  /** ws -> player 解析 */
  playerBySocket(ws: WebSocket): Player | undefined {
    return this.players.find((p) => p.ws === ws);
  }

  playerList(): PlayerInfo[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.ws !== null && p.ws.readyState === 1,
      rating: this.ranked ? p.rating : null,
    }));
  }

  /** 座位 -> 连接（供网关按座位定向发送，例如 room.joined 需要分辨 youAre）。 */
  sockets(): { id: string; color: Color; sessionId: string; ws: WebSocket | null }[] {
    return this.players.map((p) => ({ id: p.id, color: p.color, sessionId: p.sessionId, ws: p.ws }));
  }

  /** sessionId -> 座位（断线重连的身份凭据） */
  playerByToken(sessionId: string): Player | undefined {
    return this.players.find((p) => p.sessionId === sessionId);
  }

  /**
   * 断线：保留座位与全部对局状态，仅标记离线并开启宽限期倒计时。
   * 宽限期内对手可继续走子；回连者凭全量快照一次性对齐，无需重放。
   */
  markOffline(player: Player): void {
    player.ws = null;
    player.offlineUntil = Date.now() + this.graceMs;
  }

  /** 同一座位重新接入：恢复连接并撤销宽限期。 */
  reattach(player: Player, ws: WebSocket): void {
    player.ws = ws;
    player.offlineUntil = null;
  }

  /** 宽限期到期：对局中判负，等待中释放座位。返回需要广播的终局消息（若有）。 */
  expireOffline(player: Player): Extract<ServerMessage, { t: 'game.over' }> | null {
    player.offlineUntil = null;
    if (player.ws) return null; // 已回连，忽略
    if (this.status === 'playing') {
      return this.endGame(other(player.color), 'disconnect');
    }
    if (this.status === 'waiting') {
      this.players = this.players.filter((p) => p !== player);
    }
    return null;
  }

  /** 当前处于宽限期的座位（同时最多一个） */
  private offlineInfo(): OfflineInfo | null {
    const p = this.players.find((x) => x.offlineUntil !== null);
    if (!p || p.offlineUntil === null) return null;
    return { color: p.color, deadline: p.offlineUntil };
  }

  /** 广播全量快照给双方（各自视角带 youAre）。 */
  broadcastSnapshot(): void {
    for (const p of this.players) {
      if (p.ws) send(p.ws, this.snapshotFor(p.color));
    }
  }

  /** 广播任意的非快照消息。 */
  broadcast(msg: ServerMessage): void {
    for (const p of this.players) {
      if (p.ws) send(p.ws, msg);
    }
  }

  snapshotFor(youAre: Color | null): GameSnapshot {
    return {
      t: 'game.state',
      gameId: this.gameId,
      roomId: this.roomId,
      board: this.board,
      turn: this.turn,
      moves: this.moves,
      seq: this.seq,
      status: this.status,
      winner: this.winner,
      reason: this.reason,
      players: this.playerList(),
      youAre,
      offline: this.offlineInfo(),
      graceMs: this.graceMs,
      ranked: this.ranked,
    };
  }

  /**
   * 服务端权威校验 + 落子。这是全系统唯一的真相来源。
   * 任意一项不通过即整体拒绝，绝不部分改状态。
   */
  applyMove(
    player: Player,
    baseSeq: number,
    from: Cell,
    to: Cell,
  ): MoveOutcome | MoveFailure {
    if (this.status !== 'playing') return { ok: false, reason: 'not_playing' };
    if (player.color !== this.turn) return { ok: false, reason: 'not_your_turn' };
    // 乐观并发：客户端基于的版本号必须与服务端一致，否则说明状态已漂移
    if (baseSeq !== this.seq) return { ok: false, reason: 'stale_seq' };

    const piece = this.board[from.r]?.[from.c];
    if (!piece || piece.color !== player.color) return { ok: false, reason: 'no_piece' };

    const safe = getSafeMoves(this.board, from.r, from.c) as Cell[];
    if (!safe.some((m) => m.r === to.r && m.c === to.c)) {
      return { ok: false, reason: 'illegal_move' };
    }

    const notation = generateNotation(this.board, from, to, player.color);
    const { board: nextBoard, captured } = makeMove(this.board, from, to);
    this.board = nextBoard;
    this.seq += 1;
    this.turn = other(player.color);
    this.moves.push({
      seq: this.seq,
      from,
      to,
      notation,
      color: player.color,
      captured: !!captured,
    });

    const key = boardKey(this.board, this.turn);
    this.repetitions.set(key, (this.repetitions.get(key) ?? 0) + 1);

    const check = isInCheck(this.board, this.turn);

    let over: Extract<ServerMessage, { t: 'game.over' }> | null = null;
    if (captured && captured.type === 'king') {
      over = this.endGame(player.color, 'checkmate');
    } else if (!hasLegalMove(this.board, this.turn)) {
      over = this.endGame(player.color, check ? 'checkmate' : 'stalemate');
    } else if ((this.repetitions.get(key) ?? 0) >= 3) {
      over = this.endGame(null, 'repetition');
    }

    return {
      ok: true,
      accepted: {
        t: 'game.move.accepted',
        gameId: this.gameId,
        seq: this.seq,
        from,
        to,
        notation,
        color: player.color,
        turn: this.turn,
        check,
      },
      gameOver: over,
    };
  }

  /** 认输：由对手获胜。 */
  resign(player: Player): Extract<ServerMessage, { t: 'game.over' }> | null {
    if (this.status !== 'playing') return null;
    return this.endGame(other(player.color), 'resign');
  }

  /**
   * 终局统一出口：记录胜方颜色、置为 over，并触发排位结算回调。
   * winnerColor 为 null 表示和棋（三次重复局面）。
   */
  private endGame(winnerColor: Color | null, reason: string): Extract<ServerMessage, { t: 'game.over' }> {
    this.status = 'over';
    this.winnerColor = winnerColor;
    this.winner = winnerColor ? colorName(winnerColor) : null;
    this.reason = reason;
    const msg: Extract<ServerMessage, { t: 'game.over' }> = {
      t: 'game.over',
      gameId: this.gameId,
      winner: this.winner,
      reason,
    };
    // 排位局：交由 Matchmaker 结算 ELO（内部会各自下发 rating.update）
    this.onEnd?.(this);
    return msg;
  }
}

export function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
  }
}
