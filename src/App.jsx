import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import useGame from './hooks/useGame';
import Board from './components/Board';
import GameInfo from './components/GameInfo';
import StatsPanel from './components/StatsPanel';
import MoveList from './components/MoveList';
import './App.css';

export default function App() {
  const {
    board, current, selected, marks,
    gameOver, aiEnabled, aiColor, aiThinking, difficulty, log,
    moves, check, lastMove,
    redTime, blackTime, timeLimit, muted, started, paused,
    history, aiStats, readyGo, moveSeq,
    onCellClick, reset, undo, toggleAI, changeDifficulty, triggerAIMove,
    changeAIFirst, changeTimeLimit, toggleMute, replayToMove,
    start, togglePause,
  } = useGame();

  const prevAITrigger = useRef(null);
  const layoutRef = useRef(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const key = `${started}-${paused}-${aiEnabled}-${aiColor}-${current}-${gameOver}-${aiThinking}`;
    if (prevAITrigger.current === key) return;
    prevAITrigger.current = key;

    if (started && !paused && aiEnabled && current === aiColor && !gameOver && !aiThinking) {
      triggerAIMove();
    }
  }, [started, paused, aiEnabled, aiColor, current, gameOver, aiThinking, triggerAIMove]);

  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    let raf;
    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        if (!w || !h) return;
        const pad = 8;
        const s = Math.min(1, (window.innerWidth - pad) / w, (window.innerHeight - pad) / h);
        setScale(prev => (Math.abs(prev - s) < 0.001 ? prev : s));
      });
    };
    compute();
    const t = setTimeout(compute, 300);
    window.addEventListener('resize', compute);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener('resize', compute);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="layout" ref={layoutRef} style={{ transform: `scale(${scale})` }}>
        <MoveList moves={moves} activeIndex={history.length - 1} onReplayToMove={replayToMove} />
        <div className="container">
        <GameInfo
          current={current}
          gameOver={gameOver}
          aiEnabled={aiEnabled}
          aiColor={aiColor}
          aiThinking={aiThinking}
          difficulty={difficulty}
          log={log}
          check={check}
          redTime={redTime}
          blackTime={blackTime}
          timeLimit={timeLimit}
          muted={muted}
          paused={paused}
          onReset={reset}
          onUndo={undo}
          onToggleAI={toggleAI}
          onChangeDifficulty={changeDifficulty}
          onChangeAIFirst={changeAIFirst}
          onChangeTimeLimit={changeTimeLimit}
          onToggleMute={toggleMute}
          onTogglePause={togglePause}
        />
        <div className="board-wrap">
          <Board
            board={board}
            selected={selected}
            marks={marks}
            check={check}
            lastMove={lastMove}
            moveSeq={moveSeq}
            onCellClick={onCellClick}
          />
          {!started && (
            <div className="board-overlay">
              {readyGo ? (
                <div className={`readygo-text ${readyGo}`}>{readyGo === 'ready' ? 'Ready' : 'Go!'}</div>
              ) : (
                <>
                  <div className="board-overlay-text">准备对局</div>
                  <button className="start-btn" onClick={start}>开始对局</button>
                </>
              )}
            </div>
          )}
        </div>
        </div>
        {aiEnabled && <StatsPanel board={board} stats={aiStats} />}
      </div>
    </div>
  );
}
