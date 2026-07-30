import { useState, useCallback, useRef } from 'react';
import { initBoard, getLegalMoves, makeMove } from '../utils/gameLogic';
import { getAIMove } from '../services/aiService';

export default function useGame() {
  const [board, setBoard] = useState(initBoard);
  const [current, setCurrent] = useState('red');
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const [difficulty, setDifficulty] = useState('medium');
  const [log, setLog] = useState('红方先行，点击棋子开始');
  const aiRef = useRef(false);

  const doMove = useCallback((from, to) => {
    const { board: newBoard, captured } = makeMove(board, from, to);
    const next = current === 'red' ? 'black' : 'red';

    if (captured && captured.type === 'king') {
      setBoard(newBoard);
      setCurrent(next);
      setSelected(null);
      setMarks([]);
      setGameOver(current === 'red' ? '红方' : '黑方');
      setLog(`${current === 'red' ? '红方' : '黑方'}胜利！`);
      return { board: newBoard, next, gameOver: true };
    }

    setBoard(newBoard);
    setCurrent(next);
    setSelected(null);
    setMarks([]);
    setLog(`${next === 'red' ? '请红方走棋' : 'AI思考中...'}`);
    return { board: newBoard, next, gameOver: false };
  }, [board, current]);

  const onCellClick = useCallback((r, c) => {
    if (aiThinking || gameOver) return;
    if (aiEnabled && current === 'black') return;

    const p = board[r][c];

    if (selected) {
      if (selected.r === r && selected.c === c) {
        setSelected(null);
        setMarks([]);
        return;
      }

      const moves = getLegalMoves(board, selected.r, selected.c);
      const isValid = moves.some(m => m.r === r && m.c === c);

      if (isValid) {
        const result = doMove({ r: selected.r, c: selected.c }, { r, c });
        if (result.gameOver) return;
      } else {
        if (p && p.color === current) {
          setSelected({ r, c });
          setMarks(getLegalMoves(board, r, c));
        } else {
          setLog('非法走子，请重新选择');
        }
      }
    } else {
      if (p && p.color === current) {
        setSelected({ r, c });
        setMarks(getLegalMoves(board, r, c));
      } else {
        setLog('请选择己方棋子');
      }
    }
  }, [board, current, selected, aiThinking, gameOver, aiEnabled, doMove]);

  const reset = useCallback(() => {
    setBoard(initBoard());
    setCurrent('red');
    setSelected(null);
    setMarks([]);
    setGameOver(null);
    setAiThinking(false);
    aiRef.current = false;
    setLog('棋盘已重置，红方先行');
  }, []);

  const toggleAI = useCallback(() => {
    setAiEnabled(prev => !prev);
    setLog(aiEnabled ? 'AI对手已关闭' : 'AI对手已开启');
  }, [aiEnabled]);

  const changeDifficulty = useCallback((d) => {
    setDifficulty(d);
    setLog(`难度已切换至: ${d === 'easy' ? '简单' : d === 'medium' ? '中等' : '困难'}`);
  }, []);

  const triggerAIMove = useCallback(() => {
    if (aiRef.current) return;
    aiRef.current = true;
    setAiThinking(true);
    setLog('AI思考中...');

    setTimeout(() => {
      try {
        const move = getAIMove(board, difficulty);
        if (!move) {
          setLog('AI无合法走法');
          setAiThinking(false);
          aiRef.current = false;
          return;
        }
        doMove(move.from, move.to);
      } catch {
        setLog('AI走棋异常');
      }
      setAiThinking(false);
      aiRef.current = false;
    }, 50);
  }, [board, doMove, difficulty]);

  return {
    board, current, selected, marks,
    gameOver, aiEnabled, aiThinking, difficulty, log,
    onCellClick, reset, toggleAI, changeDifficulty, triggerAIMove,
  };
}
