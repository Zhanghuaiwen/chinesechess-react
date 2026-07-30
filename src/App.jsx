import { useEffect, useRef } from 'react';
import useGame from './hooks/useGame';
import Board from './components/Board';
import GameInfo from './components/GameInfo';
import './App.css';

export default function App() {
  const {
    board, current, selected, marks,
    gameOver, aiEnabled, aiThinking, difficulty, log,
    onCellClick, reset, toggleAI, changeDifficulty, triggerAIMove,
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
    </div>
  );
}
