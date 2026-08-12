import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PikafishClient } from './pikafish-client.js';
import { uciToMove } from '../../src/utils/fen.js';

const RELEASE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'Pikafish-master', 'release');

function scoreLabel(s) {
  if (!s) return '?';
  if (s.type === 'mate') return s.value > 0 ? `胜${s.value}步` : `负${s.value}步`;
  return (s.value / 100).toFixed(2);
}

// 从 info 行里抽出 {multipv, depth, score:{type,value}, pv:[...]}
function parseInfo(l) {
  const m = l.match(/info depth (\d+) .*multipv (\d+) .*score (cp|mate) (-?\d+).* pv (.+)$/);
  if (!m) return null;
  return {
    depth: Number(m[1]),
    multipv: Number(m[2]),
    score: { type: m[3], value: Number(m[4]) },
    pv: m[5].split(' '),
  };
}

// 对每个 multipv 取搜索到最深的那个 pv 行
function bestPerLine(lines, k) {
  const best = new Map();
  for (const l of lines) {
    const p = parseInfo(l);
    if (!p || p.multipv > k) continue;
    const cur = best.get(p.multipv);
    if (!cur || p.depth > cur.depth) best.set(p.multipv, p);
  }
  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
}

const engine = new PikafishClient(join(RELEASE, 'Pikafish.exe'), { cwd: RELEASE });
await engine.init({ threads: 4, hash: 64 });
await engine.setOption('MultiPV', 6);

engine.setPositionStartpos();
engine.go({ movetime: 4000 });
await engine.awaitBestmove(30000);

const rows = bestPerLine(engine.lines, 6);
console.log(`初始局面(红先) 引擎 MultiPV=6, 思考 4 秒:`);
console.log('  排名  评分    深度  候选走法    应用坐标        后续着法(引擎预期应手)');
for (const p of rows) {
  const first = p.pv[0];
  const mv = uciToMove(first);
  console.log(
    `  #${p.multipv}    ${scoreLabel(p.score).padStart(6)}  ${String(p.depth).padStart(3)}   ${first.padEnd(5)}  (${mv.from.r},${mv.from.c}->${mv.to.r},${mv.to.c})   ${p.pv.slice(1).join(' ')}`,
  );
}

engine.quit();
