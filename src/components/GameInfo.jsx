import { DIFFICULTY } from '../services/aiService';

export default function GameInfo({ current, gameOver, aiEnabled, aiThinking, difficulty, log, onReset, onUndo, onToggleAI, onChangeDifficulty }) {
  const turnLabel = current === 'red' ? '红' : '黑';

  return (
    <>
      <div className="header">
        <span>中国象棋</span>
        <span className="header-right">
          <span className={`turn-label ${current}`}>{turnLabel}</span>
          {aiThinking && <span className="thinking-text">思考中...</span>}
        </span>
      </div>

      {gameOver && (
        <div className="game-over">
          {gameOver}胜利！
        </div>
      )}

      <div className="controls">
        <button onClick={onReset}>重新开局</button>
        <button onClick={onUndo} disabled={aiThinking}>悔棋</button>
        <button onClick={onToggleAI}>
          {aiEnabled ? '关闭AI' : '开启AI'}
        </button>
      </div>

      {aiEnabled && (
        <div className="difficulty-row">
          <span className="difficulty-label">AI难度</span>
          <div className="difficulty-group">
            {Object.entries(DIFFICULTY).map(([key, cfg]) => (
              <button
                key={key}
                className={`difficulty-btn ${difficulty === key ? 'active' : ''}`}
                onClick={() => onChangeDifficulty(key)}
              >
                {cfg.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div id="log">{log}</div>
    </>
  );
}
