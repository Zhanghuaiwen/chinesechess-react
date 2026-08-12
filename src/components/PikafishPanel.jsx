import { useEffect, useState } from 'react';
import { engine } from '../engine/EngineController';
import { UIManager } from '../engine/UIManager';

// 用局面分换算"软胜率"，避免引擎 WDL 模型在领先约 300 厘兵后就钉死在 100%。
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

export default function PikafishPanel({ board, current }) {
  // 订阅引擎控制器的快照：事件驱动更新，不再组件内自行轮询/延时取数。
  const [analysis, setAnalysis] = useState(() => engine.getState());
  useEffect(() => engine.subscribe(setAnalysis), []);

  const { loading, data, error, mode } = analysis;
  // 引擎数据防御：任何字段异常都不允许泄漏到 React 渲染树导致白屏。
  let wdl = null;
  let score = null;
  let rows = [];
  try {
    wdl = data ? winModel(data) : null;
    score = data ? redScore(data) : null;
    const side = data?.sideToMove || current;
    rows = UIManager.buildSidebarRows(data, board, side, mode === 'deep' ? Infinity : 5);
  } catch (e) {
    console.error('[PikafishPanel] render derive error:', e);
  }

  return (
    <div className="pikafish-panel">
      <div className="stats-header">
        Pikafish
        <span className={`pf-mode ${mode}`}>{mode === 'deep' ? '大师辅助' : '标准'}</span>
      </div>

      {loading && !error && (
        <div className="pf-status">分析中...</div>
      )}
      {!loading && error && (
        <div className="pf-status pf-error">引擎未连接<br />{error}</div>
      )}

      {!loading && data && (
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
            {data.depth ? <span className="pf-depth">深度 {data.depth} · {rows.length} 路</span> : null}
          </div>
          <div className={`pf-moves ${mode === 'deep' ? 'pf-moves-deep' : ''}`}>
            {rows.length === 0 && <div className="pf-muted">暂无数据</div>}
            {rows.map((m) => (
              <div className="pf-move-row" key={m.rank}>
                <span className="pf-move-rank">{m.rank}</span>
                <span className="pf-move-notation">{m.notation}</span>
                <span className={`pf-move-score pf-${m.tone}`}>{m.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}