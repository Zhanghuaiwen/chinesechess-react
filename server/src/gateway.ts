import type { WebSocket } from 'ws';
import { store } from './store.js';
import { send } from './room.js';
import { matchmaker } from './matchmaker.js';
import { ratings } from './ratings.js';
import { accounts, type AccountRecord } from './accounts.js';
import type { AuthUser, ClientMessage } from './protocol.js';

const MAX_ROOM_ID = 32;

function fail(ws: WebSocket, code: string, msg: string): void {
  send(ws, { t: 'error', code, msg });
}

/** 账号 -> 下发给客户端的公开信息（不含盐/哈希） */
function toAuthUser(a: AccountRecord): AuthUser {
  return { playerId: a.playerId, username: a.username, name: a.displayName };
}

function parse(raw: string): ClientMessage | null {
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== 'string') return null;
    return obj as ClientMessage;
  } catch {
    return null;
  }
}

/**
 * 单个连接的消息处理器。所有入口都做形状校验，保证服务端不会因脏输入崩溃。
 */
export function handleMessage(ws: WebSocket, raw: string): void {
  const msg = parse(raw);
  if (!msg) {
    fail(ws, 'bad_message', '无法解析的消息');
    return;
  }

  switch (msg.t) {
    case 'ping':
      send(ws, { t: 'pong', ts: msg.ts });
      return;

    case 'room.join': {
      const roomId = typeof msg.roomId === 'string' ? msg.roomId.trim() : '';
      if (!roomId || roomId.length > MAX_ROOM_ID) {
        fail(ws, 'bad_room', '房间号非法');
        return;
      }
      // 昵称必须归一化为字符串|undefined，避免非字符串入参触发 seat() 内 name?.trim() 抛错
      const name = typeof msg.name === 'string' ? msg.name : undefined;
      const { game, player } = store.joinRoom(roomId, ws, name);
      if (!player) {
        fail(ws, 'room_full', '房间已满，请稍后重试');
        return;
      }
      if (game.playerCount < 2) {
        // 已入座，等待对手。同时下发 sessionId，保证等待期间断线也能回连
        send(ws, {
          t: 'room.waiting',
          roomId,
          gameId: game.gameId,
          youAre: player.color,
          sessionId: player.sessionId,
          players: game.playerList(),
        });
      } else {
        // 两人齐 -> 开局。先各自收到 room.joined（带自己颜色与 sessionId），再收全量快照
        for (const s of game.sockets()) {
          if (s.ws && s.ws.readyState === 1) {
            send(s.ws, {
              t: 'room.joined',
              gameId: game.gameId,
              roomId: game.roomId,
              youAre: s.color,
              sessionId: s.sessionId,
              players: game.playerList(),
            });
          }
        }
      }
      game.broadcastSnapshot();
      return;
    }

    case 'room.resume': {
      const gameId = typeof msg.gameId === 'string' ? msg.gameId : '';
      const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId : '';
      const game = store.getGame(gameId);
      const player = game?.playerByToken(sessionId);
      if (!game || !player) {
        fail(ws, 'resume_failed', '对局不存在或重连凭据已失效');
        return;
      }
      // 网络抖动可能残留旧连接：直接替换为本连接
      if (player.ws && player.ws !== ws) {
        try {
          player.ws.close();
        } catch {
          /* 旧连接关闭失败不影响回连 */
        }
      }
      if (player.graceTimer) {
        clearTimeout(player.graceTimer);
        player.graceTimer = null;
      }
      game.reattach(player, ws);

      send(ws, {
        t: 'room.joined',
        gameId: game.gameId,
        roomId: game.roomId,
        youAre: player.color,
        sessionId: player.sessionId,
        players: game.playerList(),
      });
      // 回连即收到全量权威快照，客户端据此重新对齐棋盘/回合/seq
      game.broadcastSnapshot();
      return;
    }

    case 'game.move': {
      const game = store.getGame(msg.gameId) ?? store.findGameBySocket(ws);
      if (!game) {
        fail(ws, 'no_game', '对局不存在');
        return;
      }
      const player = game.playerBySocket(ws);
      if (!player) {
        fail(ws, 'not_a_player', '你不在该对局中');
        return;
      }
      const from = msg.from;
      const to = msg.to;
      if (!isCell(from) || !isCell(to) || typeof msg.baseSeq !== 'number') {
        fail(ws, 'bad_move', '走子参数非法');
        return;
      }
      const outcome = game.applyMove(player, msg.baseSeq, from, to);
      if (!outcome.ok) {
        send(ws, {
          t: 'game.move.rejected',
          gameId: game.gameId,
          seq: game.currentSeq,
          reason: outcome.reason,
        });
        return;
      }
      // 确认给走子方（带 notation / check），并让双方收全量快照保持完全同步
      send(ws, outcome.accepted);
      game.broadcastSnapshot();
      if (outcome.gameOver) game.broadcast(outcome.gameOver);
      return;
    }

    case 'game.resign': {
      const game = store.getGame(msg.gameId) ?? store.findGameBySocket(ws);
      if (!game) {
        fail(ws, 'no_game', '对局不存在');
        return;
      }
      const player = game.playerBySocket(ws);
      if (!player) {
        fail(ws, 'not_a_player', '你不在该对局中');
        return;
      }
      const over = game.resign(player);
      if (over) {
        game.broadcastSnapshot();
        game.broadcast(over);
      }
      return;
    }

    case 'sync.request': {
      const game = store.getGame(msg.gameId) ?? store.findGameBySocket(ws);
      if (!game) {
        fail(ws, 'no_game', '对局不存在');
        return;
      }
      const player = game.playerBySocket(ws);
      send(ws, game.snapshotFor(player?.color ?? null));
      return;
    }

    case 'match.join': {
      // 已登录时以令牌身份为准，忽略客户端自报 playerId，避免冒用他人分数
      const account = accounts.verify(msg.token);
      const playerId = account ? account.playerId : (typeof msg.playerId === 'string' ? msg.playerId.trim() : '');
      if (!playerId) {
        fail(ws, 'bad_player', '缺少玩家标识');
        return;
      }
      // 已登录用户的展示名固定为账号昵称，不允许每局改名
      const name = account ? account.displayName : (typeof msg.name === 'string' ? msg.name : undefined);
      matchmaker.join(ws, playerId, name);
      return;
    }

    case 'match.leave': {
      matchmaker.remove(ws);
      return;
    }

    case 'profile.get': {
      const account = accounts.verify(msg.token);
      const playerId = account ? account.playerId : (typeof msg.playerId === 'string' ? msg.playerId : '');
      const rec = ratings.get(playerId, account?.displayName);
      send(ws, {
        t: 'profile',
        playerId,
        name: rec.name,
        rating: rec.rating,
        games: rec.games,
        wins: rec.wins,
        losses: rec.losses,
        draws: rec.draws,
      });
      return;
    }

    case 'auth.register': {
      const res = accounts.register(msg.username, msg.password, msg.name);
      if (!res.ok) {
        send(ws, { t: 'auth.error', code: res.code, msg: res.msg });
        return;
      }
      // 注册时把当前游客身份的战绩迁到新账号，避免“刚注册就变回 1200 分”
      ratings.transfer(msg.guestId, res.account.playerId);
      send(ws, { t: 'auth.ok', token: res.token, user: toAuthUser(res.account) });
      return;
    }

    case 'auth.login': {
      const res = accounts.login(msg.username, msg.password);
      if (!res.ok) {
        send(ws, { t: 'auth.error', code: res.code, msg: res.msg });
        return;
      }
      send(ws, { t: 'auth.ok', token: res.token, user: toAuthUser(res.account) });
      return;
    }

    case 'auth.me': {
      const account = accounts.verify(msg.token);
      if (!account) {
        send(ws, { t: 'auth.error', code: 'invalid_token', msg: '登录状态已失效' });
        return;
      }
      send(ws, { t: 'auth.ok', token: msg.token, user: toAuthUser(account) });
      return;
    }

    case 'auth.logout': {
      accounts.logout(msg.token);
      send(ws, { t: 'auth.loggedOut' });
      return;
    }

    case 'leaderboard.get': {
      const limit = typeof msg.limit === 'number' && Number.isFinite(msg.limit) ? msg.limit : 20;
      send(ws, {
        t: 'leaderboard',
        list: ratings.top(limit).map((r) => ({
          name: r.name,
          rating: r.rating,
          games: r.games,
          wins: r.wins,
          losses: r.losses,
          draws: r.draws,
        })),
      });
      return;
    }

    default:
      fail(ws, 'unknown_type', `未知消息类型: ${(msg as { t: string }).t}`);
  }
}

/**
 * 连接关闭：保留座位、开启宽限期倒计时并广播离线状态。
 * 宽限期内原客户端凭 sessionId 回连即撤销；超时未回连则对局中判负、等待中释放座位。
 */
export function handleClose(ws: WebSocket): void {
  // 排队中掉线：先出队，避免占位导致对手被匹配到「幽灵」
  matchmaker.remove(ws);

  const game = store.findGameBySocket(ws);
  if (!game) return;
  const player = game.playerBySocket(ws);
  if (!player) return;

  game.markOffline(player);
  if (player.graceTimer) clearTimeout(player.graceTimer);

  player.graceTimer = setTimeout(() => {
    player.graceTimer = null;
    const over = game.expireOffline(player);
    game.broadcastSnapshot();
    if (over) game.broadcast(over);
    store.reap(game);
  }, game.graceMs);

  game.broadcastSnapshot();
}

function isCell(v: unknown): v is { r: number; c: number } {
  return (
    !!v &&
    typeof (v as { r: unknown }).r === 'number' &&
    typeof (v as { c: unknown }).c === 'number' &&
    Number.isInteger((v as { r: number }).r) &&
    Number.isInteger((v as { c: number }).c) &&
    (v as { r: number }).r >= 0 &&
    (v as { r: number }).r < 10 &&
    (v as { c: number }).c >= 0 &&
    (v as { c: number }).c < 9
  );
}
