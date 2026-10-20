import { useCallback, useEffect, useRef, useState } from 'react';
import { OnlineClient, WS_URL } from '../services/onlineService';
import { initBoard, getSafeMoves, isInCheck } from '../../shared/gameLogic';

const REASON_LABEL = {
  checkmate: '将死',
  stalemate: '困毙',
  repetition: '三次重复局面判和',
  resign: '认输',
  timeout: '超时',
  disconnect: '断线超时',
};

const REJECT_LABEL = {
  not_playing: '对局未开始',
  not_a_player: '你不在对局中',
  not_your_turn: '还没轮到你走棋',
  stale_seq: '状态已更新，已为你重新同步',
  no_piece: '没有可动的棋子',
  illegal_move: '非法走子',
};

/** 排位结算结果文案 */
const RESULT_LABEL = { win: '胜利', loss: '失败', draw: '和棋' };

/** 本地会话凭据：断线或刷新页面后用它 reclaim 原座位 */
const SESSION_KEY = 'cc.online.session';

function readSession() {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(s) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* 隐私模式等场景下写入失败，忽略即可 */
  }
}

function clearSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 匿名排位身份：localStorage 中持久化的 UUID，作为 ELO 分数归属键 */
const PLAYER_ID_KEY = 'cc.playerId';

function getPlayerId() {
  try {
    // 允许用 ?pid=xxx 显式指定身份：便于同机多标签演示/测试（默认用户走 localStorage）
    const fromUrl = new URLSearchParams(window.location.search).get('pid');
    if (fromUrl) return fromUrl;
    let id = window.localStorage.getItem(PLAYER_ID_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() ?? `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      window.localStorage.setItem(PLAYER_ID_KEY, id);
    }
    return id;
  } catch {
    return `p_${Date.now()}`;
  }
}

/** 登录令牌：localStorage 持久化；换浏览器或清缓存后需重新用账号密码登录 */
const AUTH_TOKEN_KEY = 'cc.authToken';

function readToken() {
  try {
    return window.localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(token) {
  try {
    if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/**
 * 联机对局状态机（P2：断线重连 + 状态同步）。
 *
 * 两条铁律：
 *   1) 客户端不做权威落子 —— 本地只用 getSafeMoves 做交互提示，落子交服务端裁决；
 *   2) 服务端全量快照是唯一真相 —— 断线回连后直接以快照覆盖本地状态，
 *      因此**无需重放历史走法**，seq 自然对齐。
 *
 * 身份方案：
 *   - 游客：localStorage 的 UUID（cc.playerId），本机有效，换浏览器即丢失；
 *   - 账号：登录后服务端给出固定 playerId，令牌存 localStorage（cc.authToken），
 *     跨浏览器/清缓存都能靠用户名密码找回分数。
 *   - 对局座位：入座时服务端下发 sessionId，存 sessionStorage，仅用于断线重连。
 */
export default function useOnlineGame() {
  const [conn, setConn] = useState('idle'); // idle | connecting | open | reconnecting | closed
  const [phase, setPhase] = useState('lobby'); // lobby | resuming | waiting | playing | over
  const [roomId, setRoomId] = useState('');
  const [gameId, setGameId] = useState(null);
  const [youAre, setYouAre] = useState(null);
  const [players, setPlayers] = useState([]);
  const [board, setBoard] = useState(initBoard);
  const [turn, setTurn] = useState('red');
  const [moves, setMoves] = useState([]);
  const [seq, setSeq] = useState(0);
  const [winner, setWinner] = useState(null);
  const [reason, setReason] = useState(null);
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState([]);
  const [lastMove, setLastMove] = useState(null);
  const [moveSeq, setMoveSeq] = useState(0);
  const [log, setLog] = useState('输入房间号，与好友开一局');
  const [offline, setOffline] = useState(null);
  const [offlineRemaining, setOfflineRemaining] = useState(0);
  // ── P1 排位匹配相关 ──
  const [ranked, setRanked] = useState(false);
  const [myRating, setMyRating] = useState(null);
  const [profile, setProfile] = useState(null); // {rating, games, wins, losses, draws}
  const [queue, setQueue] = useState(null); // {waiting, band}
  const [opponent, setOpponent] = useState(null); // {name, rating}
  const [ratingResult, setRatingResult] = useState(null); // {result, you, opponent}
  const [leaderboard, setLeaderboard] = useState(null); // 排行榜条目数组
  // ── 账号相关 ──
  const [guestId] = useState(() => getPlayerId()); // 游客身份（ELO 归属键）
  const [account, setAccount] = useState(null); // 已登录账号 {playerId, username, name}
  const [authError, setAuthError] = useState(''); // 登录/注册错误提示
  const tokenRef = useRef(readToken());
  const accountRef = useRef(null);
  /** 当前身份：登录后为账号 playerId，否则为游客 id */
  const uid = account?.playerId ?? guestId;

  const clientRef = useRef(null);
  const handlerRef = useRef(null);
  const statusRef = useRef(null);
  const prevBoardRef = useRef(null);
  const sessionRef = useRef(null);
  /** 连接可用时要重放的“意图”：加入房间 或 恢复对局 */
  const desiredRef = useRef(null);
  /** 连接尚未就绪时的登录/注册消息，open 后补发 */
  const pendingAuthRef = useRef(null);

  /** 当前身份的 playerId：登录后为账号 id，否则为游客 id */
  const currentPlayerId = useCallback(() => accountRef.current?.playerId ?? getPlayerId(), []);

  // ── 会话凭据读写 ──
  const rememberSession = useCallback((patch) => {
    const next = { ...(sessionRef.current ?? {}), ...patch };
    sessionRef.current = next;
    if (next.gameId && next.sessionId) {
      writeSession(next);
      // 一旦落到具体对局，重连一律走 resume 而不是重新 join/match
      desiredRef.current = { kind: 'resume', gameId: next.gameId, sessionId: next.sessionId };
    }
  }, []);

  // ── 连接就绪后按意图重放 ──
  // 首次加入发 room.join；随机匹配发 match.join；断线/刷新后回连发 room.resume。
  const sendPending = useCallback(() => {
    const d = desiredRef.current;
    const c = clientRef.current;
    if (!d || !c) return;
    if (d.kind === 'resume') {
      c.send({ t: 'room.resume', gameId: d.gameId, sessionId: d.sessionId });
    } else if (d.kind === 'match') {
      c.send({ t: 'match.join', playerId: d.playerId, name: d.name, token: d.token || undefined });
    } else {
      c.send({ t: 'room.join', roomId: d.roomId, name: d.name });
    }
  }, []);

  // ── 应用一帧服务端快照 ──
  // 用「上一帧棋盘」重建 lastMove 的棋子对象，供 Board 的飞行动画使用。
  const applySnapshot = useCallback((msg) => {
    const nb = msg.board;
    const prev = prevBoardRef.current;
    const latest = msg.moves.length ? msg.moves[msg.moves.length - 1] : null;

    let lm = null;
    if (latest && prev) {
      lm = {
        from: latest.from,
        to: latest.to,
        piece: nb[latest.to.r][latest.to.c],
        captured: prev[latest.to.r][latest.to.c],
      };
    }

    prevBoardRef.current = nb;
    setBoard(nb);
    setTurn(msg.turn);
    setMoves(msg.moves);
    setSeq(msg.seq);
    if (msg.youAre) setYouAre(msg.youAre);
    setPlayers(msg.players);
    setWinner(msg.winner);
    setReason(msg.reason);
    setOffline(msg.offline ?? null);
    setLastMove(lm);
    setMoveSeq(msg.seq);
    setSelected(null);
    setMarks([]);
    // 排位局：展示双方分数（快照已带 rating），并清空排队态
    setRanked(!!msg.ranked);
    setQueue(null);
    if (msg.ranked) {
      const me = msg.players.find((p) => p.color === msg.youAre);
      if (me && me.rating != null) setMyRating(me.rating);
      const opp = msg.players.find((p) => p.color && p.color !== msg.youAre);
      if (opp) setOpponent({ name: opp.name, rating: opp.rating });
    }

    if (msg.status === 'over') {
      // 终局：清理会话凭据，刷新页面后回到大厅而不是尝试恢复已结束的对局
      clearSession();
      sessionRef.current = null;
      desiredRef.current = null;
      setPhase('over');
      setLog(msg.winner
        ? `${msg.winner}胜利（${REASON_LABEL[msg.reason] || msg.reason}）`
        : `和棋（${REASON_LABEL[msg.reason] || msg.reason}）`);
      return;
    }
    if (msg.status === 'waiting') {
      setPhase('waiting');
      setLog('房间已创建，等待对手加入...');
      return;
    }
    setPhase('playing');
    if (msg.offline && msg.offline.color !== msg.youAre) {
      setLog('对手已断线，等待重连...');
    } else if (isInCheck(msg.board, msg.turn)) {
      setLog(msg.turn === msg.youAre ? '你被将军！' : '对手被将军！');
    } else {
      setLog(msg.turn === msg.youAre ? '轮到你走棋' : '等待对手走棋');
    }
  }, []);

  // ── 消息分发 ──
  const handleMessage = useCallback((msg) => {
    switch (msg.t) {
      case 'room.waiting':
        setRoomId(msg.roomId);
        setGameId(msg.gameId);
        setYouAre(msg.youAre);
        setPlayers(msg.players);
        setRanked(false);
        setQueue(null);
        rememberSession({ roomId: msg.roomId, gameId: msg.gameId, sessionId: msg.sessionId });
        setPhase('waiting');
        setLog(`房间 ${msg.roomId} 已创建，等待对手加入...`);
        break;
      case 'room.joined':
        setRoomId(msg.roomId);
        setGameId(msg.gameId);
        setYouAre(msg.youAre);
        setPlayers(msg.players);
        rememberSession({ roomId: msg.roomId, gameId: msg.gameId, sessionId: msg.sessionId });
        setLog(msg.youAre === 'red' ? '你执红先行' : '你执黑后行');
        break;
      case 'profile':
        setProfile(msg);
        setMyRating(msg.rating);
        break;
      case 'match.queued':
        setMyRating(msg.rating);
        setQueue({ waiting: msg.waiting, band: msg.band });
        setPhase('queuing');
        setLog(msg.waiting > 1
          ? `匹配中… 队列 ${msg.waiting} 人，当前分段区间 ±${msg.band ?? '不限'}`
          : '匹配中… 正在寻找实力相近的对手');
        break;
      case 'match.found':
        setRoomId(msg.roomId);
        setGameId(msg.gameId);
        setYouAre(msg.youAre);
        setPlayers(msg.players);
        setOpponent(msg.opponent);
        setQueue(null);
        rememberSession({ roomId: msg.roomId, gameId: msg.gameId, sessionId: msg.sessionId });
        setLog(`匹配成功！对手 ${msg.opponent.name}（${msg.opponent.rating} 分）`);
        break;
      case 'rating.update':
        setRatingResult(msg);
        setMyRating(msg.you.rating);
        setLog(
          `${RESULT_LABEL[msg.result] ?? msg.result}　排位分 ${msg.you.before} → ${msg.you.rating}` +
          `（${msg.you.delta >= 0 ? '+' : ''}${msg.you.delta}）`,
        );
        break;
      case 'leaderboard':
        setLeaderboard(msg.list);
        break;
      case 'auth.ok': {
        tokenRef.current = msg.token;
        writeToken(msg.token);
        accountRef.current = msg.user;
        setAccount(msg.user);
        setAuthError('');
        setLog(`已登录：${msg.user.name}`);
        // 换身份后立刻刷新档案，避免继续显示游客分数
        clientRef.current?.send({ t: 'profile.get', playerId: msg.user.playerId, token: msg.token });
        break;
      }
      case 'auth.error':
        if (msg.code === 'invalid_token') {
          // 令牌过期：静默退回游客模式
          tokenRef.current = '';
          writeToken('');
          accountRef.current = null;
          setAccount(null);
        } else {
          setAuthError(msg.msg);
        }
        break;
      case 'auth.loggedOut':
        setLog('已退出登录，回到游客模式');
        break;
      case 'game.state':
        applySnapshot(msg);
        break;
      case 'game.move.rejected':
        setLog(`走子被拒：${REJECT_LABEL[msg.reason] || msg.reason}`);
        setSelected(null);
        setMarks([]);
        // 本地与服务端出现分歧，主动拉一次权威快照重新对齐
        clientRef.current?.send({ t: 'sync.request', gameId: msg.gameId });
        break;
      case 'error':
        if (msg.code === 'resume_failed') {
          // 服务端已无此对局（重启 / 宽限期已过），退回大厅
          clearSession();
          sessionRef.current = null;
          desiredRef.current = null;
          setPhase('lobby');
          setGameId(null);
          setYouAre(null);
          setPlayers([]);
          setLog('对局已失效或已结束，请重新加入房间');
        } else {
          setLog(`服务端错误：${msg.msg}`);
        }
        break;
      default:
        break;
    }
  }, [applySnapshot, rememberSession]);

  useEffect(() => {
    handlerRef.current = handleMessage;
  }, [handleMessage]);

  useEffect(() => {
    statusRef.current = (s) => {
      setConn(s);
      if (s === 'open') {
        sendPending();
        // 连接就绪：先用已存令牌恢复登录态，再拉档案/榜单（顺序保证 rating 取的是账号分数）
        const t = tokenRef.current;
        if (pendingAuthRef.current) {
          const msg = pendingAuthRef.current;
          pendingAuthRef.current = null;
          clientRef.current?.send(msg);
        } else if (t) {
          clientRef.current?.send({ t: 'auth.me', token: t });
        }
        clientRef.current?.send({ t: 'profile.get', playerId: currentPlayerId(), token: t || undefined });
        clientRef.current?.send({ t: 'leaderboard.get', limit: 10 });
      } else if (s === 'reconnecting') {
        setLog('连接断开，正在自动重连...');
      } else if (s === 'closed') {
        setLog('连接已断开，重连失败，请确认服务端已启动');
      }
    };
  }, [sendPending, currentPlayerId]);

  // ── 客户端实例 ──
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      const c = new OnlineClient(WS_URL);
      c.onStatus((s) => statusRef.current && statusRef.current(s));
      // 经 ref 转发，避免闭包捕获旧的 handler
      c.onMessage((m) => handlerRef.current && handlerRef.current(m));
      clientRef.current = c;
    }
    return clientRef.current;
  }, []);

  useEffect(() => () => clientRef.current?.close(), []);

  // ── 断线宽限期倒计时 ──
  useEffect(() => {
    if (!offline) {
      setOfflineRemaining(0);
      return;
    }
    const tick = () => setOfflineRemaining(Math.max(0, Math.ceil((offline.deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [offline]);

  // ── 挂载即连线：有未结束对局则自动恢复（刷新也能续上），否则拉一次排位档案 ──
  useEffect(() => {
    const saved = readSession();
    const c = getClient();
    if (saved && saved.gameId && saved.sessionId) {
      sessionRef.current = saved;
      setRoomId(saved.roomId || '');
      desiredRef.current = { kind: 'resume', gameId: saved.gameId, sessionId: saved.sessionId };
      setPhase('resuming');
      setLog('检测到未结束的对局，正在恢复...');
    } else {
      setLog('输入房间号与好友开一局，或点击随机匹配');
    }
    c.connect();
    if (c.status === 'open') sendPending();
  }, [getClient, sendPending]);

  /** 清空上一局的棋盘/对局态（开始新的房间局或匹配局前调用） */
  const resetRound = useCallback(() => {
    setWinner(null);
    setReason(null);
    setOffline(null);
    setMoves([]);
    setSeq(0);
    setMoveSeq(0);
    setLastMove(null);
    setSelected(null);
    setMarks([]);
    setOpponent(null);
    setRatingResult(null);
    prevBoardRef.current = null;
  }, []);

  const joinRoom = useCallback((rid, name) => {
    const room = String(rid || '').trim();
    if (!room) {
      setLog('请填写房间号');
      return;
    }
    const c = getClient();
    sessionRef.current = { roomId: room, gameId: null, sessionId: null, name: name ?? '' };
    desiredRef.current = { kind: 'join', roomId: room, name };
    setRoomId(room);
    setPhase('waiting');
    setRanked(false);
    setQueue(null);
    resetRound();
    setLog('正在连接服务器...');
    c.connect();
    if (c.status === 'open') sendPending();
  }, [getClient, sendPending, resetRound]);

  /** 进入随机匹配队列（P1） */
  const findMatch = useCallback((name) => {
    const playerId = currentPlayerId();
    const c = getClient();
    sessionRef.current = { roomId: '', gameId: null, sessionId: null, name: name ?? '' };
    desiredRef.current = { kind: 'match', playerId, name, token: tokenRef.current };
    setRoomId('');
    setGameId(null);
    setYouAre(null);
    setPlayers([]);
    resetRound();
    setPhase('queuing');
    setQueue(null);
    setLog('正在加入匹配队列...');
    c.connect();
    if (c.status === 'open') sendPending();
  }, [getClient, sendPending, resetRound, currentPlayerId]);

  /** 登录：成功后由 auth.ok 统一更新状态 */
  const login = useCallback((username, password) => {
    setAuthError('');
    const msg = { t: 'auth.login', username, password };
    const c = getClient();
    if (!c.send(msg)) {
      pendingAuthRef.current = msg;
      c.connect();
    }
  }, [getClient]);

  /** 注册：带上当前游客 id，服务端会把游客战绩迁到新账号 */
  const register = useCallback((username, password, name) => {
    setAuthError('');
    const msg = { t: 'auth.register', username, password, name, guestId: getPlayerId() };
    const c = getClient();
    if (!c.send(msg)) {
      pendingAuthRef.current = msg;
      c.connect();
    }
  }, [getClient]);

  /** 退出登录：令牌失效并回到游客身份 */
  const logout = useCallback(() => {
    const t = tokenRef.current;
    if (t) clientRef.current?.send({ t: 'auth.logout', token: t });
    tokenRef.current = '';
    writeToken('');
    accountRef.current = null;
    setAccount(null);
    setAuthError('');
    setProfile(null);
    setMyRating(null);
    clientRef.current?.send({ t: 'profile.get', playerId: getPlayerId() });
  }, []);

  /** 取消匹配 */
  const cancelMatch = useCallback(() => {
    desiredRef.current = null;
    sessionRef.current = null;
    clientRef.current?.send({ t: 'match.leave' });
    setPhase('lobby');
    setQueue(null);
    setLog('已取消匹配');
  }, []);

  const leaveRoom = useCallback(() => {
    desiredRef.current = null;
    sessionRef.current = null;
    clearSession();
    clientRef.current?.close();
    setPhase('lobby');
    setGameId(null);
    setYouAre(null);
    setPlayers([]);
    setRanked(false);
    setQueue(null);
    setRoomId('');
    resetRound();
    setLog('已离开房间');
  }, [resetRound]);

  const resign = useCallback(() => {
    if (!gameId) return;
    clientRef.current?.send({ t: 'game.resign', gameId });
  }, [gameId]);

  // ── 交互层：只做选择高亮，落子提交给服务端 ──
  const onCellClick = useCallback((r, c) => {
    if (phase !== 'playing') {
      setLog('对局尚未开始');
      return;
    }
    if (turn !== youAre) {
      setLog('还没轮到你走棋');
      return;
    }
    const p = board[r][c];

    if (selected) {
      if (selected.r === r && selected.c === c) {
        setSelected(null);
        setMarks([]);
        return;
      }
      const valid = getSafeMoves(board, selected.r, selected.c).some((m) => m.r === r && m.c === c);
      if (valid) {
        const from = { r: selected.r, c: selected.c };
        const sent = clientRef.current?.send({
          t: 'game.move',
          gameId,
          baseSeq: seq,
          from,
          to: { r, c },
        });
        setSelected(null);
        setMarks([]);
        setLog(sent ? '已提交走子，等待服务端裁决...' : '连接已断开，无法提交');
        return;
      }
      if (p && p.color === youAre) {
        setSelected({ r, c });
        setMarks(getSafeMoves(board, r, c));
        return;
      }
      setLog('非法走子，请重新选择');
      return;
    }

    if (p && p.color === youAre) {
      setSelected({ r, c });
      setMarks(getSafeMoves(board, r, c));
    } else {
      setLog('请选择己方棋子');
    }
  }, [phase, turn, youAre, board, selected, seq, gameId]);

  const check = phase === 'playing' || phase === 'over' ? (isInCheck(board, turn) ? turn : null) : null;

  return {
    conn, phase, roomId, gameId, youAre, players,
    board, turn, moves, seq, winner, reason,
    selected, marks, check, lastMove, moveSeq, log,
    offline, offlineRemaining,
    ranked, myRating, profile, queue, opponent, ratingResult,
    uid, leaderboard, account, authError,
    joinRoom, leaveRoom, resign, onCellClick, findMatch, cancelMatch,
    login, register, logout,
  };
}
