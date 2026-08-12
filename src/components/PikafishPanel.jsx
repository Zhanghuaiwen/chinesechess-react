import { useEffect, useRef, useState } from 'react';
import { boardToFEN, uciToMove } from '../utils/fen';
import { generateNotation } from '../utils/gameLogic';

const ANALYZE_URL = '/__pikafish/analyze';

function moverScore(score) {
  if (!score) return null;
  if (score.type === 'mate') return score.value > 0 ? `杀${score.value}` : `被杀${-score.value}`;
  const v = score.value / 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
}

// 用局面分换算“软胜率”，避免引擎 WDL 模型在领先约 300 厘兵后就钉死在 100%。
// logistic(scale=400): 多1兵(+100)≈64%, 多1马(+400)≈88%, 多1车(+900)≈95%, 永不归1。
function winModel(data) {
  if (!data.score) return null;
  const s = data.sideToMove === 'red' ? data.score.value : -data.score.value;
  if (data.score.type === 'mate') {
    return s > 0 ? { redWin: 99, draw: 1, blackWin: 0 } : { redWin: 0, draw: 1, blackWin: 99 };
  }
  const win = 100 / (1 + 10 ** (-s / 400));
  const draw = Math.round(60 * Math.exp(-Math.abs(s) / 180));
  const redWin = Math.round((win * (100 - draw)) / 100);
  const blackWin = 100 - redWin - draw;
  return { redWin, draw, blackWin };
}

// 局面分转红方视角
function redScore(data) {
  if (!data.score) return null;
  const s = data.score;
  if (s.type === 'mate') {
    const redSide = s.value > 0 ? data.sideToMove : data.sideToMove === 'red' ? 'black' : 'red';
    return { text: `${redSide === 'red' ? '红方' : '黑方'}胜${Math.abs(s.value)}步`, redSide, mate: true };
  }
  const redValue = data.sideToMove === 'red' ? s.value : -s.value;
  return {
    text: `${redValue >= 0 ? '+' : ''}${(redValue / 100).toFixed(2)}`,
    redSide: redValue > 0 ? 'red' : redValue < 0 ? 'black' : 'draw',
    mate: false,
  };
}

export default function PikafishPanel({ board, current, moveSeq }) {
  const [state, setState] = useState({ loading: true, ok: false, data: null, error: null });
  const seqRef = useRef(0);

  useEffect(() => {
    const fen = boardToFEN(board, current);
    const seq = ++seqRef.current;
    setState((s) => ({ ...s, loading: true }));

    const t = setTimeout(async () => {
      try {
        const res = await fetch(ANALYZE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fen, multiPV: 5, movetime: 2000 }),
        });
        const data = await res.json();
        if (seq !== seqRef.current) return;
        if (!data.ok) throw new Error(data.error || '引擎异常');
        setState({ loading: false, ok: true, data, error: null });
      } catch (e) {
        if (seq !== seqRef.current) return;
        setState({ loading: false, ok: false, data: null, error: String(e?.message || e) });
      }
    }, 500);

    return () => clearTimeout(t);
  }, [board, current, moveSeq]);

  const { loading, ok, data, error } = state;
  const wdl = data ? winModel(data) : null;
  const score = data ? redScore(data) : null;

  const moves = [];
  if (ok && data) {
    for (const m of data.moves) {
      if (!m.move) continue;
      const mv = uciToMove(m.move);
      let notation;
      try {
        notation = generateNotation(board, mv.from, mv.to, current);
      } catch {
        notation = m.move;
      }
      moves.push({ rank: m.rank, notation, score: moverScore(m.score) });
    }
  }

  return (
    <div className="pikafish-panel">
      <div className="stats-header">Pikafish</div>

      {loading && ok === false && error === null && (
        <div className="pf-status">分析中...</div>
      )}
      {!ok && error !== null && (
        <div className="pf-status pf-error">引擎未连接<br />{error}</div>
      )}

      {ok && data && (
        <>
          <div className="pf-metric">
            <div className="pf-label">实时胜率</div>
            {wdl ? (
              <>
                <div className="pf-bar">
                  <span className="pf-bar-red" style={{ width: `${wdl.redWin}%` }} />
                  <span className="pf-bar-draw" style={{ width: `${wdl.draw}%` }} />
                  <span className="pf-bar-black" style={{ width: `${wdl.blackWin}%` }} />
                </div>
                <div className="pf-bar-legend">
                  <span className="pf-red">红 {wdl.redWin}%</span>
                  <span className="pf-draw">和 {wdl.draw}%</span>
                  <span className="pf-black">黑 {wdl.blackWin}%</span>
                </div>
              </>
            ) : (
              <div className="pf-muted">—</div>
            )}
          </div>

          <div className="pf-metric">
            <div className="pf-label">局面分</div>
            {score ? (
              <div className={`pf-score ${score.mate ? 'pf-score-mate' : score.redSide === 'red' ? 'pf-good' : score.redSide === 'black' ? 'pf-bad' : 'pf-eq'}`}>
                {score.text}
              </div>
            ) : (
              <div className="pf-muted">—</div>
            )}
          </div>

          <hr className="pf-divider" />

          <div className="pf-moves-title">
            主要着法
            {data.depth ? <span className="pf-depth">深度 {data.depth}</span> : null}
          </div>
          <div className="pf-moves">
            {moves.length === 0 && <div className="pf-muted">暂无数据</div>}
            {moves.map((m) => (
              <div className="pf-move-row" key={m.rank}>
                <span className="pf-move-rank">{m.rank}</span>
                <span className="pf-move-notation">{m.notation}</span>
                <span className={`pf-move-score ${m.score?.startsWith('+') ? 'pf-good' : m.score?.startsWith('-') || m.score?.includes('被杀') ? 'pf-bad' : ''}`}>
                  {m.score}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
