import { useEffect, useState } from 'react';
import { engine } from '../engine/EngineController';
import { UIManager, scoreColor } from '../engine/UIManager';

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

// 局面分转"玩家视角"：AI 先手(执红)时玩家执黑，分数不再死盯红方。
// view 为玩家视角的厘兵数值(杀棋 ±100000)，供红正蓝负配色使用。
function playerScore(data, perspective) {
  if (!data.score) return null;
  const s = data.score;
  if (s.type === 'mate') {
    // 杀棋方 = 分值为正的"行棋方"，否则是另一侧
    const winner = s.value > 0 ? data.sideToMove : data.sideToMove === 'red' ? 'black' : 'red';
    const playerWins = winner === perspective;
    return {
      text: `${playerWins ? '你' : 'AI'}胜${Math.abs(s.value)}步`,
      view: playerWins ? 100000 : -100000,
    };
  }
  const view = data.sideToMove === perspective ? s.value : -s.value;
  return {
    text: `${view >= 0 ? '+' : ''}${(view / 100).toFixed(2)}`,
    view,
  };
}

export default function PikafishPanel({
  board,
  current,
  aiColor = 'black',
  aiEnabled = true,
  assistOn = false,
  onToggleAssist,
}) {
  // 订阅引擎控制器的快照：事件驱动更新，不再组件内自行轮询/延时取数。
  const [analysis, setAnalysis] = useState(() => engine.getState());
  useEffect(() => engine.subscribe(setAnalysis), []);

  const { loading, data, error, mode } = analysis;
  // 玩家视角：AI 先手(执红)时玩家执黑，分数/胜率/着法全部跟随玩家。
  const perspective = aiEnabled && aiColor === 'red' ? 'black' : 'red';

  // 引擎数据防御：任何字段异常都不允许泄漏到 React 渲染树导致白屏。
  let wdl = null;
  let score = null;
  let rows = [];
  try {
    const raw = data ? winModel(data) : null;
    if (raw) {
      wdl = {
        playerWin: perspective === 'red' ? raw.redWin : raw.blackWin,
        draw: raw.draw,
        aiWin: perspective === 'red' ? raw.blackWin : raw.redWin,
      };
    }
    score = data ? playerScore(data, perspective) : null;
    const side = data?.sideToMove || current;
    rows = UIManager.buildSidebarRows(data, board, side, mode === 'deep' ? Infinity : 5, perspective);
  } catch (e) {
    console.error('[PikafishPanel] render derive error:', e);
  }

  return (
    <div className="pikafish-panel">
      <div className="stats-header">
        <span className="pf-title">Pikafish</span>
        <button
          className={UIManager.buttonClasses(assistOn)}
          onClick={onToggleAssist}
          aria-pressed={assistOn}
          title={assistOn ? '关闭大师模式' : '开启大师模式'}
        >
          {assistOn ? '关闭大师' : '开启大师'}
        </button>
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
                  <span className="pf-bar-player" style={{ width: `${wdl.playerWin}%` }} />
                  <span className="pf-bar-draw" style={{ width: `${wdl.draw}%` }} />
                  <span className="pf-bar-ai" style={{ width: `${wdl.aiWin}%` }} />
                </div>
                <div className="pf-bar-legend">
                  <span className="pf-player">你 {wdl.playerWin}%</span>
                  <span className="pf-draw">和 {wdl.draw}%</span>
                  <span className="pf-ai">AI {wdl.aiWin}%</span>
                </div>
              </>
            ) : (
              <div className="pf-muted">—</div>
            )}
          </div>

          <div className="pf-metric">
            <div className="pf-label">局面分</div>
            {score ? (
              <div className={`pf-score ${score.view > 0 && Math.abs(score.view) >= 100000 ? 'pf-score-mate' : ''}`} style={{ color: scoreColor(score.view) }}>
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
                <span className="pf-move-score" style={{ color: m.color }}>{m.text}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
