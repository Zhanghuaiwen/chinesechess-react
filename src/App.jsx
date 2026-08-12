import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import useGame from './hooks/useGame';
import Board from './components/Board';
import GameInfo from './components/GameInfo';
import StatsPanel from './components/StatsPanel';
import MoveList from './components/MoveList';
import PikafishPanel from './components/PikafishPanel';
import { engine } from './engine/EngineController';
import { HeatmapRenderer } from './engine/HeatmapRenderer';
import { buildAndRate } from './engine/MoveIndicatorRenderer';
import { UIManager } from './engine/UIManager';
import { boardToFEN } from './utils/fen';
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
  const heatCanvasRef = useRef(null);
  const heatRendererRef = useRef(null);
  const [scale, setScale] = useState(1);

  // ── 大师辅助状态 ──
  const [assistOn, setAssistOn] = useState(false);
  const [boardAnimating, setBoardAnimating] = useState(false);
  // 引擎快照版本号：任一状态更新 -> 触发热力图/面板重算
  const [engineTick, setEngineTick] = useState(0);

  // 订阅引擎控制器：事件驱动的分析结果统一从这里进入 React。
  useEffect(() => engine.subscribe(() => setEngineTick((t) => t + 1)), []);

  // ── 任务A：事件驱动分析 ──
  // 落子成功(棋盘与行棋方变化/悔棋回放)后立即请求一次轻量分析；
  // EngineController 内部已按 assistOn 自动升级/降级为深度或标准分析。
  useEffect(() => {
    const fen = boardToFEN(board, current);
    engine.requestAnalysis(fen, current);
  }, [board, current, moveSeq]);

  // ── 任务F：启动即分析 ──
  // 挂载即棋盘初始化完成；首次分析由上面的 requestAnalysis 自动走 movetime 300，
  // analyzeOnLoad 仅作幂等兜底（详见 EngineController），不产生第二个请求。
  useEffect(() => {
    engine.analyzeOnLoad();
  }, []);

  // ── 热力图渲染器生命期 ──
  useLayoutEffect(() => {
    const canvas = heatCanvasRef.current;
    if (!canvas) return;
    heatRendererRef.current = new HeatmapRenderer(canvas);
    return () => {
      if (heatRendererRef.current) heatRendererRef.current.destroy();
      heatRendererRef.current = null;
    };
  }, []);

  // ── 热力图 + 着法指示器数据的联动绘制（rAF 防抖在 Renderer 内部）──
  useEffect(() => {
    const renderer = heatRendererRef.current;
    if (!renderer) return;

    const analysis = engine.getState();
    // 分析进行中时旧数据与新棋盘不匹配，先不上屏，避免错误着色。
    const data = analysis.loading ? null : analysis.data;

    // 计算/绘制防御：任何异常都不得泄漏到 React 渲染树导致白屏。
    try {
      const heat = assistOn && data ? UIManager.buildHeatCells(data, board) : { cells: [] };
      let selection = null;
      if (assistOn && !analysis.loading && !boardAnimating && selected) {
        // 任务G：走法"相对强度"指示器 —— 仅在大师辅助模式下启用，
        // 该模式下普通合法走法标记已由 marks=[] 屏蔽，完全由本渲染接管。
        selection = buildAndRate(data, board, selected);
      }
      renderer.setData({ isDeep: assistOn, cells: heat.cells, selection });
    } catch (e) {
      console.error('[heatmap] render pipeline error:', e);
      renderer.clear();
    }
  }, [engineTick, assistOn, boardAnimating, selected, board]);

  const toggleAssist = useCallback(() => {
    if (assistOn) {
      engine.disableDeepMode();
      setAssistOn(false);
    } else {
      engine.enableDeepMode();
      setAssistOn(true);
    }
  }, [assistOn]);

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
        <div className="assist-bar">
          <button
            className={UIManager.buttonClasses(assistOn)}
            onClick={toggleAssist}
            aria-pressed={assistOn}
          >
            🔍 大师辅助
          </button>
        </div>
        <div className="board-wrap">
          <Board
            board={board}
            selected={selected}
            marks={assistOn ? [] : marks}
            check={check}
            lastMove={lastMove}
            moveSeq={moveSeq}
            onCellClick={onCellClick}
            onAnimatingChange={setBoardAnimating}
          />
          <canvas ref={heatCanvasRef} className="heatmap-canvas" />
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
        <PikafishPanel board={board} current={current} />
      </div>
    </div>
  );
}