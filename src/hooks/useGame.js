import { useState, useCallback, useRef } from 'react';
import { initBoard, getLegalMoves, makeMove, cloneBoard } from '../utils/gameLogic';
import { getAIMove } from '../services/aiService';

export default function useGame() {
  const [board, setBoard] = useState(initBoard);
  const [current, setCurrent] = useState('red');
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiThinking, setAiThinking] = useState(false);
  const [aiStatus, setAiStatus] = useState('unknown');
  const [log, setLog] = useState('红方先行，点击棋子开始');
  const [consoleEntries, setConsoleEntries] = useState([]);
  const aiRef = useRef(false);

  const ts = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  };

  const addConsole = (entry) => {
    setConsoleEntries(prev => [...prev, { ...entry, time: ts() }]);
  };

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
      addConsole({ type: 'move', content: `🏆 ${current === 'red' ? '红方' : '黑方'}吃掉将/帅，游戏结束！` });
      return { board: newBoard, next, gameOver: true };
    }

    setBoard(newBoard);
    setCurrent(next);
    setSelected(null);
    setMarks([]);
    setLog(`${next === 'red' ? '红方' : '黑方'}走棋`);
    const fromLabel = board[from.r][from.c]?.label || '?';
    const toLabel = newBoard[to.r][to.c]?.label || '?';
    const colorLabel = current === 'red' ? '红' : '黑';
    addConsole({ type: 'move', content: `[${colorLabel}] ${fromLabel}: (${from.r},${from.c}) → (${to.r},${to.c})` });
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
          setLog('⛔ 非法走子，请重新选择');
        }
      }
    } else {
      if (p && p.color === current) {
        setSelected({ r, c });
        setMarks(getLegalMoves(board, r, c));
      } else {
        setLog('👆 请选择己方棋子');
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
    setAiStatus('unknown');
    setConsoleEntries([]);
    aiRef.current = false;
    setLog('🔄 棋盘已重置，红方先行');
  }, []);

  const toggleAI = useCallback(() => {
    setAiEnabled(prev => !prev);
    setLog(aiEnabled ? 'AI对手已关闭' : 'AI对手已开启');
  }, [aiEnabled]);

  const triggerAIMove = useCallback(async () => {
    if (aiRef.current) return;
    aiRef.current = true;
    setAiThinking(true);
    setLog('🤔 AI思考中...');
    addConsole({ type: 'separator' });
    addConsole({ type: 'info', content: '🤔 AI思考中...' });

    try {
      const result = await getAIMove(board);
      if (!result || !result.move) {
        setLog('AI无合法走法');
        setAiThinking(false);
        aiRef.current = false;
        return;
      }

      const { move, source, error, prompt, response } = result;

      if (prompt) {
        addConsole({ type: 'input', content: prompt, _open: false });
      }
      if (response) {
        addConsole({ type: 'output', content: response, _open: true });
      }

      if (source === 'ollama') {
        setAiStatus('connected');
        setLog(`🤖 AI(Ollama) 走棋: (${move.from.r},${move.from.c}) → (${move.to.r},${move.to.c})`);
      } else if (error) {
        setAiStatus('error');
        addConsole({ type: 'info', content: `⚠️ ${error}，使用随机走棋` });
        setLog(`⚠️ ${error}，使用随机走棋: (${move.from.r},${move.from.c}) → (${move.to.r},${move.to.c})`);
      } else {
        setAiStatus('random');
        setLog(`🎲 随机走棋: (${move.from.r},${move.from.c}) → (${move.to.r},${move.to.c})`);
      }

      setTimeout(() => {
        doMove(move.from, move.to);
        setAiThinking(false);
        aiRef.current = false;
      }, 300);
    } catch {
      setAiThinking(false);
      aiRef.current = false;
      setLog('❌ AI走棋异常');
    }
  }, [board, doMove]);

  return {
    board, current, selected, marks,
    gameOver, aiEnabled, aiThinking, aiStatus, log, consoleEntries,
    onCellClick, reset, toggleAI, triggerAIMove,
  };
}
