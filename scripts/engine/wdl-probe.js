import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PikafishClient } from './pikafish-client.js';
import { boardToFEN } from '../../src/utils/fen.js';
import { initBoard } from '../../src/utils/gameLogic.js';

const RELEASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Pikafish-master', 'release');

const engine = new PikafishClient(join(RELEASE, 'Pikafish.exe'), { cwd: RELEASE });
await engine.init({ threads: 4, hash: 64 });
await engine.setOption('UCI_ShowWDL', 'true');

// 红方给不同领先量：从初始局面移除指定数量的黑子
function boardWithBlackRemoved(types) {
  const b = initBoard();
  for (const t of types) {
    outer: for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = b[r][c];
        if (p && p.color === 'black' && p.type === t) {
          b[r][c] = null;
          break outer;
        }
      }
    }
  }
  return b;
}

const tests = [
  ['均势(初始局面)', initBoard()],
  ['红多1兵', boardWithBlackRemoved(['pawn'])],
  ['红多2兵', boardWithBlackRemoved(['pawn', 'pawn'])],
  ['红多1马', boardWithBlackRemoved(['knight'])],
  ['红多1车', boardWithBlackRemoved(['rook'])],
];

for (const [label, board] of tests) {
  const fen = boardToFEN(board, 'red');
  const start = engine.lines.length;
  engine.send('setoption name MultiPV value 1');
  engine.setPositionFEN(fen);
  engine.go({ movetime: 2500 });
  const bm = await engine.awaitBestmove(30000);
  const lines = engine.lines.slice(start);
  const best = lines
    .filter((l) => /multipv 1 .*score /.test(l))
    .sort((a, b) => (Number(b.match(/depth (\d+)/)?.[1] || 0)) - (Number(a.match(/depth (\d+)/)?.[1] || 0)))[0];
  const score = best.match(/score (cp|mate) (-?\d+)/);
  const wdl = best.match(/wdl (\d+) (\d+) (\d+)/);
  console.log(
    `${label.padEnd(12)}  score=${score ? score[2] + score[1] : '?'}   wdl=${wdl ? `${wdl[1]}/${wdl[2]}/${wdl[3]}` : '?'}   (${(bm.bestmove || '?')})`,
  );
}
engine.quit();
