import { createPortal } from 'react-dom';
import { DIFFICULTY } from '../services/aiService';

const REASON_LABEL = {
  checkmate: '将死',
  stalemate: '困毙',
  timeout: '超时',
  repetition: '三次重复局面判和',
};

function fmt(sec, limited) {
  if (!limited) return '--:--';
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export default function GameInfo({
  current, gameOver, aiEnabled, aiColor, aiThinking, difficulty, log,
  check, redTime, blackTime, timeLimit, muted, paused,
  onReset, onUndo, onToggleAI, onChangeDifficulty,
  onChangeAIFirst, onChangeTimeLimit, onToggleMute, onTogglePause,
}) {
  const turnLabel = current === 'red' ? '红' : '黑';
  const playerFirst = aiColor === 'black';
  const winner = gameOver && gameOver.winner;
  const reason = gameOver && gameOver.reason;

  return (
    <>
      <div className="header">
        <span>中国象棋</span>
        <span className="header-right">
          {check && <span className="check-badge">将军！</span>}
          {aiThinking && <span className="thinking-text">思考中...</span>}
          <span className={`turn-label ${current}`}>{turnLabel}</span>
        </span>
      </div>

      {gameOver && (
        <div className="game-over">
          {winner ? `${winner}胜利！（${REASON_LABEL[reason]}）` : `和棋！（${REASON_LABEL[reason]}）`}
        </div>
      )}

      <div className="clock-row">
        <div className={`clock red ${current === 'red' && !gameOver ? 'active' : ''}`}>
          <span className="clock-name">红方</span>
          <span className="clock-time">{fmt(redTime, timeLimit > 0)}</span>
        </div>
        <div className={`clock black ${current === 'black' && !gameOver ? 'active' : ''}`}>
          <span className="clock-name">黑方</span>
          <span className="clock-time">{fmt(blackTime, timeLimit > 0)}</span>
        </div>
      </div>

      <div className="controls">
        <button onClick={onReset}>重新开局</button>
        <button onClick={onUndo} disabled={aiThinking}>悔棋</button>
        <button onClick={onToggleAI}>{aiEnabled ? '关闭AI' : '开启AI'}</button>
        <button className={`settings-btn ${paused ? 'active' : ''}`} onClick={onTogglePause}>
          设置
        </button>
      </div>

      <div id="log">{log}</div>

      {paused && createPortal(
        <div className="settings-overlay" onClick={onTogglePause}>
          <div className="settings-card" onClick={e => e.stopPropagation()}>
            <div className="settings-card-title">设置</div>

            <div className="settings-group">
              <span className="settings-group-label">先手</span>
              <div className="difficulty-group">
                <button className={`difficulty-btn ${playerFirst ? 'active' : ''}`} onClick={() => onChangeAIFirst('black')}>玩家</button>
                <button className={`difficulty-btn ${!playerFirst ? 'active' : ''}`} onClick={() => onChangeAIFirst('red')}>AI</button>
              </div>
            </div>

            <div className="settings-group">
              <span className="settings-group-label">时限</span>
              <div className="difficulty-group">
                {[5, 10, 20, 0].map(min => (
                  <button
                    key={min}
                    className={`difficulty-btn ${timeLimit === min ? 'active' : ''}`}
                    onClick={() => onChangeTimeLimit(min)}
                  >
                    {min === 0 ? '不限' : `${min}分`}
                  </button>
                ))}
              </div>
            </div>

            {aiEnabled && (
              <div className="settings-group">
                <span className="settings-group-label">AI难度</span>
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

            <div className="settings-group">
              <span className="settings-group-label">音效</span>
              <div className="difficulty-group">
                <button className={`difficulty-btn ${!muted ? 'active' : ''}`} onClick={onToggleMute}>
                  {muted ? '关闭' : '开启'}
                </button>
              </div>
            </div>

            <button className="settings-close" onClick={onTogglePause}>完成</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
