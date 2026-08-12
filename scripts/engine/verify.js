import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PikafishClient } from './pikafish-client.js';
import {
  boardToFEN,
  fenToBoard,
  moveToUCI,
  uciToMove,
} from '../../src/utils/fen.js';
import {
  initBoard,
  makeMove,
  getSafeMoves,
} from '../../src/utils/gameLogic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASE = join(__dirname, '..', '..', 'Pikafish-master', 'release');
const EXE = join(RELEASE, 'Pikafish.exe');
const NNUE = join(RELEASE, 'pikafish.nnue');

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  [PASS] ${name}${detail ? '   ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? '   ' + detail : ''}`);
  }
};

const pieceTag = (p) => (p ? `${p.label || p.type}[${p.color}]` : '空');

console.log('== 1. 应用棋盘 <-> 引擎 FEN 转换 ==');
const startBoard = initBoard();
const fen = boardToFEN(startBoard, 'red');
check('boardToFEN(initBoard) 与引擎 StartFEN 一致', fen === START_FEN, fen);

const { board: b2, sideToMove: side } = fenToBoard(START_FEN);
check('fenToBoard 行棋方 = red', side === 'red', side);
let same = true;
outer: for (let r = 0; r < 10; r++) {
  for (let c = 0; c < 9; c++) {
    const a = startBoard[r][c];
    const b = b2[r][c];
    if ((a?.type ?? null) !== (b?.type ?? null) || (a?.color ?? null) !== (b?.color ?? null)) {
      same = false;
      break outer;
    }
  }
}
check('fenToBoard 棋盘与 initBoard() 完全一致', same);

const mvPao = { from: { r: 7, c: 7 }, to: { r: 7, c: 4 } };
check('炮 moveToUCI -> h2e2', moveToUCI(mvPao) === 'h2e2', moveToUCI(mvPao));
const back = uciToMove('h2e2');
check(
  'h2e2 -> 应用坐标 {7,7}->{7,4}',
  back.from.r === 7 && back.from.c === 7 && back.to.r === 7 && back.to.c === 4,
  JSON.stringify(back),
);

console.log('== 2. 引擎 UCI 联调 ==');
const engine = new PikafishClient(EXE, { cwd: RELEASE });
await engine.init({ threads: 4, hash: 64 });
await engine.setOption('EvalFile', NNUE);
console.log('  引擎已就绪(Threads=4, Hash=64MB, EvalFile=pikafish.nnue)');

// 2a. 红先
engine.setPositionFEN(fen);
engine.go({ movetime: 2500 });
const r1 = await engine.awaitBestmove();
console.log(`  引擎(红) bestmove = ${r1.bestmove}${r1.ponder ? `  ponder = ${r1.ponder}` : ''}`);
const mv1 = uciToMove(r1.bestmove);
check('红方走的是红子', startBoard[mv1.from.r][mv1.from.c]?.color === 'red', `${pieceTag(startBoard[mv1.from.r][mv1.from.c])}@(${mv1.from.r},${mv1.from.c})`);
check(
  '红方走法在应用合法着法内',
  getSafeMoves(startBoard, mv1.from.r, mv1.from.c).some((x) => x.r === mv1.to.r && x.c === mv1.to.c),
  `->(${mv1.to.r},${mv1.to.c}) = ${r1.bestmove}`,
);
const after1 = makeMove(startBoard, mv1.from, mv1.to).board;

// 2b. 黑应
const fenBlack = boardToFEN(after1, 'black');
engine.setPositionFEN(fenBlack);
engine.go({ movetime: 2000 });
const r2 = await engine.awaitBestmove();
console.log(`  引擎(黑) bestmove = ${r2.bestmove}`);
const mv2 = uciToMove(r2.bestmove);
check('黑方走的是黑子', after1[mv2.from.r][mv2.from.c]?.color === 'black', `${pieceTag(after1[mv2.from.r][mv2.from.c])}@(${mv2.from.r},${mv2.from.c})`);
check(
  '黑方走法在应用合法着法内',
  getSafeMoves(after1, mv2.from.r, mv2.from.c).some((x) => x.r === mv2.to.r && x.c === mv2.to.c),
  `->(${mv2.to.r},${mv2.to.c}) = ${r2.bestmove}`,
);
const after2 = makeMove(after1, mv2.from, mv2.to).board;

// 2c. moves 走法列表路径
engine.setPositionStartpos([moveToUCI(mv1), moveToUCI(mv2)]);
engine.go({ movetime: 1500 });
const r3 = await engine.awaitBestmove();
console.log(`  position startpos moves 列表  -> bestmove = ${r3.bestmove}`);
const mv3 = uciToMove(r3.bestmove);
check(
  '走法列表路径结果在应用合法着法内',
  getSafeMoves(after2, mv3.from.r, mv3.from.c).some((x) => x.r === mv3.to.r && x.c === mv3.to.c),
  `->(${mv3.to.r},${mv3.to.c}) = ${r3.bestmove}`,
);

// 2d. 引擎 d 命令输出 FEN 与应用换算一致(只比对布局+行棋方)
engine.send('d');
await new Promise((r) => setTimeout(r, 200));
const fenLine = engine.lines.find((l) => l.startsWith('Fen:'));
const engineFen = fenLine ? fenLine.replace(/^Fen:\s*/, '') : null;
const appFen = boardToFEN(after2, 'red');
const layoutEqual = (a, b) => a.split(' ')[0] === b.split(' ')[0] && a.split(' ')[1] === b.split(' ')[1];
check(
  '引擎"d"输出 FEN 与应用 boardToFEN 一致(布局+行棋方)',
  engineFen !== null && layoutEqual(engineFen, appFen),
  `engine=${engineFen}  app=${appFen}`,
);

// 2e. 中局自定义 FEN 往返
const midFen = 'r1bakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w - - 0 1';
const { board: midBoard, sideToMove: midSide } = fenToBoard(midFen);
const rebuilt = boardToFEN(midBoard, midSide);
check('中局 FEN -> 棋盘 -> FEN 往返一致', rebuilt.split(' ')[0] === midFen.split(' ')[0], rebuilt);
engine.setPositionFEN(rebuilt);
engine.go({ movetime: 1200 });
const r4 = await engine.awaitBestmove();
console.log(`  中局(红车对黑将) bestmove = ${r4.bestmove}`);
const mv4 = uciToMove(r4.bestmove);
check(
  '中局走法在应用合法着法内',
  getSafeMoves(midBoard, mv4.from.r, mv4.from.c).some((x) => x.r === mv4.to.r && x.c === mv4.to.c),
  `->(${mv4.to.r},${mv4.to.c}) = ${r4.bestmove}`,
);

engine.quit();

console.log(`\n== 结果: ${pass} 通过 / ${fail} 失败 ==`);
process.exit(fail > 0 ? 1 : 0);
