export default function GameInfo({ current, gameOver, aiEnabled, aiThinking, aiStatus, log, onReset, onToggleAI }) {
  const turnLabel = current === 'red' ? '红' : '黑';

  const statusIcon = () => {
    if (!aiEnabled) return null;
    if (aiThinking) return '🤔';
    if (aiStatus === 'connected') return '🟢';
    if (aiStatus === 'error') return '🔴';
    if (aiStatus === 'random') return '🟡';
    return '⚪';
  };

  return (
    <>
      <div className="header">
        <span>🐴 中国象棋</span>
        <span className="header-right">
          <span className={`turn-label ${current}`}>{turnLabel}</span>
          {aiEnabled && !gameOver && (
            <span className={`ai-badge ${aiThinking ? 'thinking' : ''} ${aiStatus}`}>
              {statusIcon()}
            </span>
          )}
        </span>
      </div>

      {gameOver && (
        <div className="game-over">
          🏆 {gameOver}胜利！
        </div>
      )}

      <div className="controls">
        <button onClick={onReset}>🔄 重新开局</button>
        <button onClick={onToggleAI}>
          {aiEnabled ? '🤖 关闭AI' : '🧑 开启AI'}
        </button>
      </div>

      <div id="log">{log}</div>
    </>
  );
}
