import { useEffect, useRef } from 'react';
import useGame from './hooks/useGame';
import Board from './components/Board';
import GameInfo from './components/GameInfo';
import StatsPanel from './components/StatsPanel';
import './App.css';

export default function App() {
  const {
    board, current, selected, marks,
    gameOver, aiEnabled, aiThinking, difficulty, log,
    aiStats,
    onCellClick, reset, undo, toggleAI, changeDifficulty, triggerAIMove,
  } = useGame();

  const prevAITrigger = useRef(null);

  useEffect(() => {
    const key = `${aiEnabled}-${current}-${gameOver}-${aiThinking}`;
    if (prevAITrigger.current === key) return;
    prevAITrigger.current = key;

    if (aiEnabled && current === 'black' && !gameOver && !aiThinking) {
      triggerAIMove();
    }
  }, [aiEnabled, current, gameOver, aiThinking, triggerAIMove]);

  return (
    <div className="layout">
      <div className="container">
        <GameInfo
          current={current}
          gameOver={gameOver}
          aiEnabled={aiEnabled}
          aiThinking={aiThinking}
          difficulty={difficulty}
          log={log}
          onReset={reset}
          onUndo={undo}
          onToggleAI={toggleAI}
          onChangeDifficulty={changeDifficulty}
        />
        <Board
          board={board}
          selected={selected}
          marks={marks}
          onCellClick={onCellClick}
        />
      </div>
      <StatsPanel board={board} stats={aiStats} />
    </div>
  );
}
