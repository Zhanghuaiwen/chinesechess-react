/**
 * P2 专项冒烟测试：断线重连 + 状态同步。
 *
 * 覆盖场景：
 *   A) 宽限期内断线重连：座位保留、sessionId 认领、回连后 seq 全量对齐、可继续走子
 *   B) 伪造 sessionId 回连被拒（resume_failed）
 *   C) 宽限期超时未回连 -> 判断线方负（reason=disconnect）
 *
 * 运行前启动服务端（建议用较短宽限期以便快速验证）：
 *   cd server
 *   $env:RECONNECT_GRACE_MS=2000; npm run start
 * 然后：
 *   node server/scripts/smoke-p2.mjs
 *
 * 说明：脚本会从服务端快照读取 graceMs，因此任何宽限期配置都能跑通。
 */
import WebSocket from 'ws';

const URL = process.env.WS_URL ?? 'ws://localhost:8787';
const ROOM_A = `p2-rc-${Date.now().toString(36)}`;
const ROOM_C = `p2-ff-${Date.now().toString(36)}`;

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } else {
    failed += 1;
    console.log(`  [FAIL] ${name}${extra ? ` -> ${extra}` : ''}`);
  }
}

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(new Error(`连接 ${URL} 失败: ${err.message}`)));
  });
}

function waitFor(ws, pred, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', on);
      reject(new Error('等待消息超时'));
    }, timeoutMs);
    function on(data) {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (pred(msg)) {
        clearTimeout(timer);
        ws.off('message', on);
        resolve(msg);
      }
    }
    ws.on('message', on);
  });
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));

async function main() {
  console.log(`P2 冒烟测试开始 -> ${URL}\n`);

  // ───────────── A. 宽限期内断线重连 ─────────────
  console.log('A. 断线重连');
  const a = await connect();
  const b = await connect();

  const aWaitP = waitFor(a, (m) => m.t === 'room.waiting');
  send(a, { t: 'room.join', roomId: ROOM_A, name: '甲' });
  const aWait = await aWaitP;
  check('A1 入座时下发 sessionId', typeof aWait.sessionId === 'string' && aWait.sessionId.length > 0);

  const aJoinedP = waitFor(a, (m) => m.t === 'room.joined');
  const bJoinedP = waitFor(b, (m) => m.t === 'room.joined');
  const aPlayP = waitFor(a, (m) => m.t === 'game.state' && m.status === 'playing');
  send(b, { t: 'room.join', roomId: ROOM_A, name: '乙' });
  const aJoined = await aJoinedP;
  const bJoined = await bJoinedP;
  const gameId = aJoined.gameId;
  const aState0 = await aPlayP;
  check('A2 快照携带 graceMs', typeof aState0.graceMs === 'number' && aState0.graceMs > 0, `graceMs=${aState0.graceMs}`);
  check('A3 开局快照 offline 为 null', aState0.offline === null);

  const acc1P = waitFor(a, (m) => m.t === 'game.move.accepted');
  send(a, { t: 'game.move', gameId, baseSeq: 0, from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
  const acc1 = await acc1P;
  check('A4 红兵走子被接受 seq=1', acc1.seq === 1, JSON.stringify(acc1));

  // b 断线：服务端保留座位并置为宽限期，对手应收到 offline 快照
  const aOffP = waitFor(a, (m) => m.t === 'game.state' && m.offline !== null);
  b.close();
  const offSnap = await aOffP;
  check('A5 对手断线后广播 offline 快照', offSnap.offline.color === 'black', `offline=${JSON.stringify(offSnap.offline)}`);
  check('A6 快照中黑方 connected=false', offSnap.players.find((p) => p.color === 'black')?.connected === false);

  // b 凭 sessionId 回连：应 reclaim 原座位并收到全量快照
  const b2 = await connect();
  const b2JoinedP = waitFor(b2, (m) => m.t === 'room.joined');
  const b2StateP = waitFor(b2, (m) => m.t === 'game.state');
  const aBackP = waitFor(a, (m) => m.t === 'game.state' && m.offline === null);
  send(b2, { t: 'room.resume', gameId, sessionId: bJoined.sessionId });

  const b2Joined = await b2JoinedP;
  check('A7 回连认领原座位（黑方，sessionId 不变）',
    b2Joined.youAre === 'black' && b2Joined.sessionId === bJoined.sessionId,
    JSON.stringify({ youAre: b2Joined.youAre }));
  const b2State = await b2StateP;
  check('A8 回连即收到全量快照，seq 与棋盘对齐（=1）',
    b2State.seq === 1 && b2State.status === 'playing' && b2State.moves.length === 1,
    `seq=${b2State.seq} moves=${b2State.moves?.length}`);
  const aBack = await aBackP;
  check('A9 对手恢复在线（offline=null，connected=true）',
    aBack.offline === null && aBack.players.find((p) => p.color === 'black')?.connected === true);

  // 回连后继续走子，验证状态机未因断线错乱
  const acc2P = waitFor(b2, (m) => m.t === 'game.move.accepted');
  const aSeq2P = waitFor(a, (m) => m.t === 'game.state' && m.seq === 2);
  send(b2, { t: 'game.move', gameId, baseSeq: 1, from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });
  const acc2 = await acc2P;
  check('A10 回连后黑卒走子被接受 seq=2', acc2.seq === 2 && acc2.turn === 'red', JSON.stringify(acc2));
  const aSeq2 = await aSeq2P;
  check('A11 a 收到 seq=2 权威快照', aSeq2.turn === 'red' && aSeq2.moves.length === 2, `moves=${aSeq2.moves?.length}`);

  // ───────────── B. 凭据失效 ─────────────
  console.log('\nB. 伪造凭据');
  const x = await connect();
  const errP = waitFor(x, (m) => m.t === 'error');
  send(x, { t: 'room.resume', gameId, sessionId: 'bogus-token' });
  const err = await errP;
  check('B1 伪造 sessionId 回连被拒 resume_failed', err.code === 'resume_failed', JSON.stringify(err));
  x.close();

  // ───────────── C. 宽限期超时判负 ─────────────
  console.log('\nC. 宽限期超时');
  const c1 = await connect();
  const c2 = await connect();
  send(c1, { t: 'room.join', roomId: ROOM_C, name: '丙' });
  await waitFor(c1, (m) => m.t === 'room.waiting');
  const c2PlayP = waitFor(c2, (m) => m.t === 'game.state' && m.status === 'playing');
  send(c2, { t: 'room.join', roomId: ROOM_C, name: '丁' });
  const c2State = await c2PlayP;
  const grace = c2State.graceMs;

  const overP = waitFor(c2, (m) => m.t === 'game.over', grace + 5000);
  c1.close();
  const over = await overP;
  check('C1 宽限期超时判断线方负（disconnect）',
    over.reason === 'disconnect' && over.winner === '黑方',
    JSON.stringify(over));

  a.close();
  b2.close();
  c2.close();

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nP2 冒烟测试异常:', err.message);
  process.exit(1);
});
