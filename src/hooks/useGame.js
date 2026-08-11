import { useState, useCallback, useRef, useEffect } from 'react';
import {
  initBoard,
  getSafeMoves,
  makeMove,
  isInCheck,
  hasLegalMove,
  generateNotation,
  boardKey,
} from '../utils/gameLogic';
import { getAIMove } from '../services/aiService';
import { sound } from '../utils/sound';
import { MOVE_MS } from '../constants';

const ZERO_STATS = { nodes: 0, prunes: 0, moves: 0, lastNodes: 0, lastPrunes: 0, lastDepth: 0, lastTimeMs: 0 };

const colorName = (color) => (color === 'red' ? '红方' : '黑方');

export default function useGame() {
  const [board, setBoard] = useState(initBoard);
  const [current, setCurrent] = useState('red');
  const [selected, setSelected] = useState(null);
  const [marks, setMarks] = useState([]);
  const [gameOver, setGameOver] = useState(null);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [aiColor, setAiColor] = useState('black');
  const [aiThinking, setAiThinking] = useState(false);
  const [difficulty, setDifficulty] = useState('medium');
  const [log, setLog] = useState('点击"开始对局"按钮开始');
  const [history, setHistory] = useState([]);
  const [moves, setMoves] = useState([]);
  const [check, setCheck] = useState(null);
  const [lastMove, setLastMove] = useState(null);
  const [redTime, setRedTime] = useState(600);
  const [blackTime, setBlackTime] = useState(600);
  const [timeLimit, setTimeLimit] = useState(10);
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [started, setStarted] = useState(false);
  const [repetitions, setRepetitions] = useState({});
  const [aiStats, setAiStats] = useState(ZERO_STATS);
  const [readyGo, setReadyGo] = useState(null);
  const [moveSeq, setMoveSeq] = useState(0);
  const aiRef = useRef(false);
  const overRef = useRef(null);
  const versionRef = useRef(0);
  const pausedRef = useRef(false);
  const countdownRef = useRef(null);

  useEffect(() => {
    overRef.current = gameOver;
  }, [gameOver]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => () => {
    if (countdownRef.current) clearTimeout(countdownRef.current);
  }, []);

  useEffect(() => {
    if (!started || gameOver || timeLimit <= 0 || paused) return;
    const id = setInterval(() => {
      if (current === 'red') setRedTime(t => Math.max(0, t - 1));
      else setBlackTime(t => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [started, gameOver, current, timeLimit, paused]);

  useEffect(() => {
    if (gameOver) return;
    const playerColor = aiColor === 'red' ? 'black' : 'red';
    const playerName = colorName(playerColor);
    if (redTime <= 0) {
      setGameOver({ winner: '黑方', reason: 'timeout' });
      setLog(aiColor === 'red' ? 'AI超时判负，你赢了！' : '红方超时判负，黑方胜利！');
      ('黑方' === playerName ? sound.win : sound.lose)();
      return;
    }
    if (blackTime <= 0) {
      setGameOver({ winner: '红方', reason: 'timeout' });
      setLog(aiColor === 'black' ? 'AI超时判负，你赢了！' : '黑方超时判负，红方胜利！');
      ('红方' === playerName ? sound.win : sound.lose)();
    }
  }, [redTime, blackTime, gameOver, aiColor]);

  const doMove = useCallback((from, to) => {
    if (gameOver) return { gameOver: true };

    const notation = generateNotation(board, from, to, current);
    const next = current === 'red' ? 'black' : 'red';
    const winnerName = colorName(current);
    const nextName = colorName(next);
    const playerColor = aiColor === 'red' ? 'black' : 'red';
    const playerName = colorName(playerColor);

    setHistory(prev => [...prev, { board, current, gameOver }]);
    const { board: newBoard, captured } = makeMove(board, from, to);
    const moving = board[from.r][from.c];

    setMoves(prev => [...prev, { notation, color: current, from, to, captured: !!captured, piece: moving }]);
    setLastMove({ from, to, captured, piece: moving });
    setMoveSeq(prev => prev + 1);
    setCheck(null);

    if (captured && captured.type === 'king') {
      setBoard(newBoard);
      setCurrent(next);
      setSelected(null);
      setMarks([]);
      setGameOver({ winner: winnerName, reason: 'checkmate' });
      setLog(`${winnerName}胜利！`);
      (winnerName === playerName ? sound.win : sound.lose)();
      return { gameOver: true };
    }

    const inCheck = isInCheck(newBoard, next);
    const hasLegal = hasLegalMove(newBoard, next);
    const key = boardKey(newBoard, next);
    const count = (repetitions[key] || 0) + 1;
    setRepetitions({ ...repetitions, [key]: count });

    if (!hasLegal) {
      setBoard(newBoard);
      setCurrent(next);
      setSelected(null);
      setMarks([]);
      setGameOver({ winner: winnerName, reason: inCheck ? 'checkmate' : 'stalemate' });
      setLog(inCheck
        ? `${winnerName}将死${nextName}，${nextName}被将死！`
        : `${nextName}困毙，无子可走判负，${winnerName}胜利！`);
      (winnerName === playerName ? sound.win : sound.lose)();
      return { gameOver: true };
    }

    if (count >= 3) {
      setBoard(newBoard);
      setCurrent(next);
      setSelected(null);
      setMarks([]);
      setGameOver({ winner: null, reason: 'repetition' });
      setLog('三次重复局面，判和！');
      sound.draw();
      return { gameOver: true };
    }

    setBoard(newBoard);
    setCurrent(next);
    setSelected(null);
    setMarks([]);

    if (inCheck) {
      setCheck(next);
      setLog(`${nextName}被将军！`);
      sound.check();
    } else if (aiEnabled && next === aiColor) {
      setLog('AI思考中...');
    } else {
      setLog(`请${nextName}走棋`);
    }

    return { gameOver: false };
  }, [board, current, gameOver, aiEnabled, aiColor, repetitions]);

  const onCellClick = useCallback((r, c) => {
    if (aiThinking || gameOver || paused) return;
    if (!started) {
      setLog('请先点击"开始对局"按钮');
      return;
    }
    if (aiEnabled && current === aiColor) return;

    const p = board[r][c];

    if (selected) {
      if (selected.r === r && selected.c === c) {
        setSelected(null);
        setMarks([]);
        return;
      }

      const pieceMoves = getSafeMoves(board, selected.r, selected.c);
      const isValid = pieceMoves.some(m => m.r === r && m.c === c);

      if (isValid) {
        doMove({ r: selected.r, c: selected.c }, { r, c });
      } else {
        if (p && p.color === current) {
          setSelected({ r, c });
          setMarks(getSafeMoves(board, r, c));
          sound.select();
        } else {
          setLog('非法走子，请重新选择');
        }
      }
    } else {
      if (p && p.color === current) {
        setSelected({ r, c });
        setMarks(getSafeMoves(board, r, c));
        sound.select();
      } else {
        setLog('请选择己方棋子');
      }
    }
  }, [board, current, selected, aiThinking, gameOver, aiEnabled, aiColor, started, paused, doMove]);

  const startNewGame = useCallback((opts = {}) => {
    const aiC = opts.aiColor !== undefined ? opts.aiColor : aiColor;
    const tl = opts.timeLimit !== undefined ? opts.timeLimit : timeLimit;
    setAiColor(aiC);
    setTimeLimit(tl);
    setBoard(initBoard());
    setCurrent('red');
    setSelected(null);
    setMarks([]);
    setGameOver(null);
    setAiThinking(false);
    setHistory([]);
    setMoves([]);
    setCheck(null);
    setLastMove(null);
    setRepetitions({});
    setRedTime(tl > 0 ? tl * 60 : 0);
    setBlackTime(tl > 0 ? tl * 60 : 0);
    setAiStats(ZERO_STATS);
    setStarted(false);
    setPaused(false);
    setReadyGo(null);
    setMoveSeq(0);
    if (countdownRef.current) {
      clearTimeout(countdownRef.current);
      countdownRef.current = null;
    }
    aiRef.current = false;
    versionRef.current++;
    setLog('点击"开始对局"按钮开始');
  }, [aiColor, timeLimit]);

  const reset = useCallback(() => startNewGame(), [startNewGame]);

  const changeAIFirst = useCallback((color) => {
    if (color === aiColor) return;
    startNewGame({ aiColor: color });
    setLog(color === 'red' ? '已切换为AI先手，重新开局' : '已切换为玩家先手，重新开局');
  }, [aiColor, startNewGame]);

  const changeTimeLimit = useCallback((min) => {
    if (min === timeLimit) return;
    startNewGame({ timeLimit: min });
    setLog(min === 0 ? '已切换为不限时，重新开局' : `已切换为每方${min}分钟，重新开局`);
  }, [timeLimit, startNewGame]);

  const start = useCallback(() => {
    if (started || gameOver || readyGo) return;
    setReadyGo('ready');
    sound.ready();
    if (countdownRef.current) clearTimeout(countdownRef.current);
    countdownRef.current = setTimeout(() => {
      setReadyGo('go');
      sound.go();
      countdownRef.current = setTimeout(() => {
        countdownRef.current = null;
        setReadyGo(null);
        setStarted(true);
        setLog(aiEnabled && aiColor === 'red' ? '对局开始，AI先手' : '对局开始，红方先行');
      }, 100);
    }, 1000);
  }, [started, gameOver, readyGo, aiEnabled, aiColor]);

  const togglePause = useCallback(() => {
    setPaused(prev => !prev);
  }, []);

  const undo = useCallback(() => {
    if (aiThinking || history.length === 0) return;

    const popCount = aiEnabled
      ? Math.min(current === aiColor ? 1 : 2, history.length)
      : 1;
    const newHistory = history.slice(0, history.length - popCount);
    const snapshot = history[history.length - popCount];
    const newMoves = moves.slice(0, newHistory.length);
    const prev = newMoves.length > 0 ? newMoves[newMoves.length - 1] : null;

    setHistory(newHistory);
    setMoves(newMoves);
    setBoard(snapshot.board);
    setCurrent(snapshot.current);
    setGameOver(snapshot.gameOver);
    setSelected(null);
    setMarks([]);
    setCheck(isInCheck(snapshot.board, snapshot.current) ? snapshot.current : null);
    setLastMove(prev ? { from: prev.from, to: prev.to, captured: prev.captured, piece: prev.piece } : null);
    setRepetitions({});
    aiRef.current = false;
    setAiThinking(false);
    versionRef.current++;
    setLog('已悔棋，请重新走棋');
  }, [aiThinking, history, moves, aiEnabled, aiColor, current]);

  const replayToMove = useCallback((index) => {
    if (aiThinking) return;
    const target = index + 1;
    if (target < 0 || target >= history.length) return;
    const snapshot = history[target];
    const keptMoves = moves.slice(0, target);
    const prev = keptMoves.length > 0 ? keptMoves[keptMoves.length - 1] : null;

    setHistory(history.slice(0, target));
    setMoves(keptMoves);
    setBoard(snapshot.board);
    setCurrent(snapshot.current);
    setGameOver(snapshot.gameOver);
    setSelected(null);
    setMarks([]);
    setCheck(isInCheck(snapshot.board, snapshot.current) ? snapshot.current : null);
    setLastMove(prev ? { from: prev.from, to: prev.to, captured: prev.captured, piece: prev.piece } : null);
    setRepetitions({});
    aiRef.current = false;
    setAiThinking(false);
    versionRef.current++;
    setLog(`已回放到第${target}手`);
  }, [aiThinking, history, moves]);

  const toggleAI = useCallback(() => {
    setAiEnabled(prev => !prev);
    setLog(aiEnabled ? 'AI对手已关闭' : 'AI对手已开启');
  }, [aiEnabled]);

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      const next = !prev;
      sound.setMuted(next);
      return next;
    });
  }, []);

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
      const version = versionRef.current;
      try {
        if (overRef.current || pausedRef.current || versionRef.current !== version) return;
        const result = getAIMove(board, difficulty, aiColor);
        if (!result || !result.move) {
          setLog('AI无合法走法');
          return;
        }
        setAiStats(prev => ({
          nodes: prev.nodes + result.nodes,
          prunes: prev.prunes + result.prunes,
          moves: prev.moves + 1,
          lastNodes: result.nodes,
          lastPrunes: result.prunes,
          lastDepth: result.depth,
          lastTimeMs: result.timeMs,
        }));
        if (overRef.current || versionRef.current !== version) return;
        doMove(result.move.from, result.move.to);      } catch {
        setLog('AI走棋异常');
      } finally {
        setAiThinking(false);
        aiRef.current = false;
      }
      // 等玩家棋子的滑动动画(MOVE_MS+30 提交落子)播完再让 AI 走子，
      // 避免 AI 过快响应导致玩家的动画被中断而"瞬移"
    }, MOVE_MS + 120);
  }, [board, doMove, difficulty, aiColor]);

  return {
    board, current, selected, marks,
    gameOver, aiEnabled, aiColor, aiThinking, difficulty, log,
    moves, check, lastMove,
    redTime, blackTime, timeLimit, muted, started, paused,
    history, aiStats, readyGo, moveSeq,
    onCellClick, reset, undo, toggleAI, changeDifficulty, triggerAIMove,
    changeAIFirst, changeTimeLimit, toggleMute, replayToMove,
    start, togglePause,
  };
}
