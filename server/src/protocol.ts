/**
 * 联机协议定义（房间制对战 + 随机匹配 + 断线重连，P0–P3 已完成）。
 *
 * 客户端 -> 服务端：
 *   {t:'room.join', roomId, name}      加入/创建房间
 *   {t:'room.resume', gameId, sessionId}  凭重连凭据 reclaim 原座位（断线/刷新后续局）
 *   {t:'game.move', gameId, baseSeq, from, to}  发起走子（baseSeq 用于乐观并发校验）
 *   {t:'game.resign', gameId}          认输
 *   {t:'sync.request', gameId}         主动拉取全量权威快照
 *   {t:'match.join', playerId, name?, token?}   进入随机匹配队列（P1）
 *   {t:'match.leave'}                  取消匹配
 *   {t:'profile.get', playerId, token?}  查询排位档案
 *   {t:'leaderboard.get', limit?}      查询排行榜（按分数降序，默认 20 条）
 *   {t:'auth.register', username, password, name?, guestId?}  注册（可把游客战绩迁入账号）
 *   {t:'auth.login', username, password}  登录
 *   {t:'auth.me', token}               用已存令牌恢复登录态
 *   {t:'auth.logout', token}           退出登录（令牌失效）
 *   {t:'ping', ts}                     心跳探测
 *
 * 服务端 -> 客户端：
 *   {t:'pong', ts}
 *   {t:'room.waiting', roomId, gameId, youAre, sessionId, players}  已入座，等待对手
 *   {t:'room.joined', gameId, roomId, youAre, sessionId, players}   对局开始（第二人入座/回连）
 *   {t:'game.state', ...}                                         全量权威快照
 *   {t:'game.move.accepted', seq, from, to, notation, color, turn, check}
 *   {t:'game.move.rejected', seq, reason}
 *   {t:'game.over', gameId, winner, reason}
 *   {t:'match.queued', rating, waiting, band}      已入队（band 为当前分段区间）
 *   {t:'match.found', gameId, roomId, youAre, sessionId, players, opponent}
 *   {t:'profile', playerId, name, rating, games, wins, losses, draws}
 *   {t:'leaderboard', list: LeaderboardEntry[]}  排行榜（按分数降序）
 *   {t:'rating.update', gameId, result, you, opponent}  排位结算（胜负和 + 分差）
 *   {t:'auth.ok', token, user}         登录/注册/恢复成功
 *   {t:'auth.error', code, msg}        登录失败（invalid_token 表示令牌过期）
 *   {t:'auth.loggedOut'}               已退出登录
 *   {t:'error', code, msg}
 */

/** 已登录用户的基本信息（分数通过 profile.get 单独取） */
export interface AuthUser {
  playerId: string;
  username: string;
  /** 展示名：排行榜与对局内使用 */
  name: string;
}

export type Color = 'red' | 'black';

export interface Cell {
  r: number;
  c: number;
}

export type Status = 'waiting' | 'playing' | 'over';

export interface MoveRecord {
  seq: number;
  from: Cell;
  to: Cell;
  notation: string;
  color: Color;
  captured: boolean;
}

export interface PlayerInfo {
  id: string;
  name: string;
  color: Color | null;
  connected: boolean;
  /** 排位分；仅排位局（random match）携带，休闲局为 null */
  rating?: number | null;
}

/** 处于断线宽限期的座位信息 */
export interface OfflineInfo {
  color: Color;
  /** 宽限期截止时间戳（ms），客户端据此显示倒计时 */
  deadline: number;
}

export interface GameSnapshot {
  t: 'game.state';
  gameId: string;
  roomId: string;
  board: unknown;
  turn: Color;
  moves: MoveRecord[];
  seq: number;
  status: Status;
  winner: string | null;
  reason: string | null;
  players: PlayerInfo[];
  youAre: Color | null;
  /** 当前处于断线宽限期的座位（同时最多一个） */
  offline: OfflineInfo | null;
  /** 服务端断线宽限期时长（ms） */
  graceMs: number;
  /** 是否为排位局（随机匹配）；休闲房号局为 false */
  ranked: boolean;
}

/** 排行榜条目：匿名身份下的排位档案摘要 */
export interface LeaderboardEntry {
  name: string;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export type ClientMessage =
  | { t: 'room.join'; roomId: string; name?: string }
  | { t: 'room.resume'; gameId: string; sessionId: string }
  | { t: 'game.move'; gameId: string; baseSeq: number; from: Cell; to: Cell }
  | { t: 'game.resign'; gameId: string }
  | { t: 'sync.request'; gameId: string }
  | { t: 'match.join'; playerId: string; name?: string; token?: string }
  | { t: 'match.leave' }
  | { t: 'profile.get'; playerId: string; token?: string }
  | { t: 'leaderboard.get'; limit?: number }
  | { t: 'auth.register'; username: string; password: string; name?: string; guestId?: string }
  | { t: 'auth.login'; username: string; password: string }
  | { t: 'auth.me'; token: string }
  | { t: 'auth.logout'; token: string }
  | { t: 'ping'; ts: number };

export type ServerMessage =
  | { t: 'pong'; ts: number }
  | {
      t: 'room.waiting';
      roomId: string;
      gameId: string;
      youAre: Color;
      sessionId: string;
      players: PlayerInfo[];
    }
  | {
      t: 'room.joined';
      gameId: string;
      roomId: string;
      youAre: Color;
      /** 该座位专属的重连凭据，客户端需持久化，断线后凭它 room.resume */
      sessionId: string;
      players: PlayerInfo[];
    }
  | GameSnapshot
  | {
      t: 'game.move.accepted';
      gameId: string;
      seq: number;
      from: Cell;
      to: Cell;
      notation: string;
      color: Color;
      turn: Color;
      check: boolean;
    }
  | { t: 'game.move.rejected'; gameId: string; seq: number; reason: string }
  | { t: 'game.over'; gameId: string; winner: string | null; reason: string }
  | { t: 'match.queued'; rating: number; waiting: number; band: number | null }
  | {
      t: 'match.found';
      gameId: string;
      roomId: string;
      youAre: Color;
      sessionId: string;
      players: PlayerInfo[];
      opponent: { name: string; rating: number };
    }
  | {
      t: 'profile';
      playerId: string;
      name: string;
      rating: number;
      games: number;
      wins: number;
      losses: number;
      draws: number;
    }
  | {
      t: 'rating.update';
      gameId: string;
      result: 'win' | 'loss' | 'draw';
      you: { rating: number; before: number; delta: number };
      opponent: { name: string; rating: number; before: number };
    }
  | { t: 'leaderboard'; list: LeaderboardEntry[] }
  | { t: 'auth.ok'; token: string; user: AuthUser }
  | { t: 'auth.error'; code: string; msg: string }
  | { t: 'auth.loggedOut' }
  | { t: 'error'; code: string; msg: string };

/** 走子被拒的原因码（前端可据此给出中文提示） */
export type RejectReason =
  | 'not_playing'
  | 'not_a_player'
  | 'not_your_turn'
  | 'stale_seq'
  | 'no_piece'
  | 'illegal_move';
