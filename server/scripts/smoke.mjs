/**
 * P0 端到端冒烟测试：两个客户端凭同一房间号入座，验证
 *   1) 座位分配与开局快照
 *   2) 红/黑合法走子被接受（服务端权威校验）
 *   3) 非法走子 / 抢行 / 陈旧 baseSeq 被拒
 *   4) 全量快照同步（seq / turn / moves）
 *   5) 认输终局与心跳
 *
 * 运行前需先启动服务端：cd server && npm run dev
 * 然后：node server/scripts/smoke.mjs
 */
import WebSocket from 'ws';

const URL = process.env.WS_URL ?? 'ws://localhost:8787';
const ROOM = process.env.ROOM ?? `smoke-${Date.now().toString(36)}`;

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

function waitFor(ws, pred, timeoutMs = 5000) {
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
  console.log(`冒烟测试开始 -> ${URL}  房间: ${ROOM}\n`);

  const a = await connect();
  const b = await connect();

  // 1. a 入座，服务端回 room.waiting
  const aWaitingP = waitFor(a, (m) => m.t === 'room.waiting');
  send(a, { t: 'room.join', roomId: ROOM, name: '甲' });
  check('a 入座后收到 room.waiting', (await aWaitingP).t === 'room.waiting');

  // 2. b 入座 -> 双方 room.joined + playing 快照
  const aJoinedP = waitFor(a, (m) => m.t === 'room.joined');
  const bJoinedP = waitFor(b, (m) => m.t === 'room.joined');
  const aPlayP = waitFor(a, (m) => m.t === 'game.state' && m.status === 'playing');
  const bPlayP = waitFor(b, (m) => m.t === 'game.state' && m.status === 'playing');
  send(b, { t: 'room.join', roomId: ROOM, name: '乙' });

  const aJoined = await aJoinedP;
  const bJoined = await bJoinedP;
  check('a 分配到红方', aJoined.youAre === 'red', `got=${aJoined.youAre}`);
  check('b 分配到黑方', bJoined.youAre === 'black', `got=${bJoined.youAre}`);
  check('双方所在对局一致', aJoined.gameId === bJoined.gameId);
  const gameId = aJoined.gameId;

  const aPlay = await aPlayP;
  await bPlayP;
  check('开局快照 seq=0 且红方先行', aPlay.seq === 0 && aPlay.turn === 'red', `seq=${aPlay.seq} turn=${aPlay.turn}`);

  // 3. 红方合法走子：兵 (6,0)->(5,0)
  const acc1P = waitFor(a, (m) => m.t === 'game.move.accepted');
  send(a, { t: 'game.move', gameId, baseSeq: 0, from: { r: 6, c: 0 }, to: { r: 5, c: 0 } });
  const acc1 = await acc1P;
  check('红兵 (6,0)->(5,0) 被接受，seq=1 轮到黑方', acc1.seq === 1 && acc1.turn === 'black', JSON.stringify(acc1));

  // 4. 非法走子：黑车 (0,0)->(0,5) 被己方马阻挡
  const rej1P = waitFor(b, (m) => m.t === 'game.move.rejected');
  send(b, { t: 'game.move', gameId, baseSeq: 1, from: { r: 0, c: 0 }, to: { r: 0, c: 5 } });
  check('黑车被阻挡判非法，拒绝原因 illegal_move', (await rej1P).reason === 'illegal_move');

  // 5. 陈旧 baseSeq：合法走法但基于旧版本号
  const rej2P = waitFor(b, (m) => m.t === 'game.move.rejected');
  send(b, { t: 'game.move', gameId, baseSeq: 0, from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });
  check('陈旧 baseSeq 被拒，原因 stale_seq', (await rej2P).reason === 'stale_seq');

  // 6. 抢行：红方在非己方回合走子
  const rej3P = waitFor(a, (m) => m.t === 'game.move.rejected');
  send(a, { t: 'game.move', gameId, baseSeq: 1, from: { r: 5, c: 0 }, to: { r: 4, c: 0 } });
  check('红方抢行被拒，原因 not_your_turn', (await rej3P).reason === 'not_your_turn');

  // 7. 黑方合法走子：卒 (3,0)->(4,0)，并核对 a 收到的全量快照
  const acc2P = waitFor(b, (m) => m.t === 'game.move.accepted');
  const st2P = waitFor(a, (m) => m.t === 'game.state' && m.seq === 2);
  send(b, { t: 'game.move', gameId, baseSeq: 1, from: { r: 3, c: 0 }, to: { r: 4, c: 0 } });
  const acc2 = await acc2P;
  check('黑卒 (3,0)->(4,0) 被接受，seq=2 轮到红方', acc2.seq === 2 && acc2.turn === 'red', JSON.stringify(acc2));
  const st2 = await st2P;
  check('a 收到 seq=2 权威快照（走法数=2，行棋方红）', st2.turn === 'red' && st2.moves.length === 2, `moves=${st2.moves?.length}`);

  // 8. 红方认输 -> 黑方胜
  const overAP = waitFor(a, (m) => m.t === 'game.over');
  const overBP = waitFor(b, (m) => m.t === 'game.over');
  send(a, { t: 'game.resign', gameId });
  const over = await overAP;
  await overBP;
  check('红方认输判黑方胜（resign）', over.winner === '黑方' && over.reason === 'resign', JSON.stringify(over));

  // 9. 心跳
  const pongP = waitFor(a, (m) => m.t === 'pong');
  const ts = Date.now();
  send(a, { t: 'ping', ts });
  check('ping 回带 pong.ts', (await pongP).ts === ts);

  a.close();
  b.close();

  console.log(`\n结果: ${passed} 通过 / ${failed} 失败`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n冒烟测试异常:', err.message);
  process.exit(1);
});
