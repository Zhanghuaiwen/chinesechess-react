import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Cell from './Cell';
import { findKing } from '../utils/gameLogic';
import { sound } from '../utils/sound';
import { MOVE_MS } from '../constants';

const CELL = 56;
const GAP = 2;
const PAD = 12;
const RIVER_H = 36;

const BOARD_W = 9 * CELL + 8 * GAP + 2 * PAD;
const BOARD_H = 10 * CELL + 10 * GAP + RIVER_H + 2 * PAD;

// 桌面端 CSS 默认值（56/2/12/36），首帧渲染与静态 viewBox 完全一致，无闪烁；
// 移动端媒体查询改用小尺寸 --cell 后由 measureMetrics() 实测 DOM 重算 viewBox。
function measureMetrics(el) {
  const q = sel => el.querySelector(`.cell[data-pos="${sel}"]`);
  const a = q('0-0');
  const b = q('0-1');
  const a1 = q('1-0');
  const b5 = q('5-0');
  if (!a || !b || !a1 || !b5) return null;

  // 外层 .layout 可能带 transform:scale，getBoundingClientRect 是缩放后的值，
  // 除以缩放系数还原为元素本地坐标，保证任意缩放下九宫线都对齐。
  const rect = el.getBoundingClientRect();
  const s = rect.width > 0 && el.clientWidth > 0 ? rect.width / el.clientWidth : 1;
  const rel = node => {
    const r = node.getBoundingClientRect();
    return { x: (r.left - rect.left) / s, y: (r.top - rect.top) / s, w: r.width / s };
  };

  const A = rel(a);
  const B = rel(b);
  const A1 = rel(a1);
  const B5 = rel(b5);
  const cell = A.w;
  const colStep = B.x - A.x;
  const rowStep = A1.y - A.y;
  const gap = Math.max(0, colStep - cell);
  const riverH = Math.max(0, B5.y - A.y - 5 * rowStep - gap);
  const w = A.x * 2 + 9 * colStep - gap;
  // 高度 = 上下内边距 + 10 行(rowStep 已含行间隙) + 楚河汉界高
  const h = A.y * 2 + 10 * rowStep + riverH;
  if (!(cell > 0 && w > 0 && h > 0)) return null;
  return { cell, colStep, rowStep, gap, riverH, pad: A.x, w, h };
}

function boardDuringAnim(board, from, to, captured) {
  return board.map((row, r) =>
    row.map((p, c) => {
      if (r === from.r && c === from.c) return null;
      if (r === to.r && c === to.c) return (captured && typeof captured === 'object') ? captured : null;
      return p;
    }),
  );
}

export default function Board({ board, selected, marks, check, lastMove, moveSeq, onCellClick, onAnimatingChange }) {
  const boardRef = useRef(null);
  const floatRef = useRef(null);
  const animBoardRef = useRef(board);
  const animTimerRef = useRef(null);
  const [displayBoard, setDisplayBoard] = useState(board);
  const [animPiece, setAnimPiece] = useState(null);
  const [animPos, setAnimPos] = useState(null);
  // 棋盘几何（本地坐标）：响应 CSS 变量/缩放变化，驱动九宫线 viewBox 精确重算
  const [metrics, setMetrics] = useState(null);
  const checkedPos = check ? findKing(board, check) : null;

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return undefined;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const m = measureMetrics(el);
        if (m) setMetrics(prev => (prev && Math.abs(prev.cell - m.cell) < 0.05 && Math.abs(prev.riverH - m.riverH) < 0.05 ? prev : m));
      });
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(measure);
      ro.observe(el);
    } else {
      window.addEventListener('resize', measure);
    }
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', measure);
    };
  }, []);

  // 首帧回退到桌面静态值，measure 完成后（通常一帧内）无缝替换
  const geo = useMemo(() => metrics || {
    cell: CELL,
    colStep: CELL + GAP,
    rowStep: CELL + GAP,
    gap: GAP,
    riverH: RIVER_H,
    pad: PAD,
    w: BOARD_W,
    h: BOARD_H,
  }, [metrics]);

  const palaces = useMemo(() => {
    const w3 = 3 * geo.colStep - geo.gap;
    return [
      { x: geo.pad + 3 * geo.colStep, y: geo.pad, w: w3, h: w3 },
      { x: geo.pad + 3 * geo.colStep, y: geo.pad + 7 * geo.rowStep + geo.riverH + geo.gap, w: w3, h: w3 },
    ];
  }, [geo]);

  // 向父级汇报棋子是否正在飞行动画中，用于网关"点击棋子看推荐着法"的触发条件
  useEffect(() => {
    if (onAnimatingChange) onAnimatingChange(!!animPiece);
  }, [animPiece, onAnimatingChange]);

  useLayoutEffect(() => {
    if (moveSeq === 0 || !lastMove || !lastMove.piece) {
      animBoardRef.current = board;
      setAnimPiece(null);
      setAnimPos(null);
      setDisplayBoard(board);
      return;
    }

    const { from, to, piece, captured } = lastMove;
    animBoardRef.current = board;
    setAnimPiece({ from, to, piece, captured: !!captured });
    setDisplayBoard(boardDuringAnim(board, from, to, captured));

    const s = measure(from.r, from.c);
    const e = measure(to.r, to.c);
    setAnimPos(s && e ? { from: s, to: e } : null);

    animTimerRef.current = setTimeout(() => {
      animBoardRef.current = board;
      setAnimPiece(null);
      setAnimPos(null);
      setDisplayBoard(board);
      if (captured) sound.capture();
      else sound.move();
    }, MOVE_MS + 30);

    return () => {
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSeq]);

  useLayoutEffect(() => {
    const el = floatRef.current;
    if (!el || !animPos) return;
    const dx = animPos.to.x - animPos.from.x;
    const dy = animPos.to.y - animPos.from.y;
    const anim = el.animate(
      [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${dx}px, ${dy}px)` },
      ],
      { duration: MOVE_MS, easing: 'ease-in-out', fill: 'forwards' },
    );
    return () => anim.cancel();
  }, [animPos]);

  useLayoutEffect(() => {
    if (animBoardRef.current === board) return;
    if (animTimerRef.current) clearTimeout(animTimerRef.current);
    animBoardRef.current = board;
    setAnimPiece(null);
    setAnimPos(null);
    setDisplayBoard(board);
  }, [board]);

  function measure(r, c) {
    const el = boardRef.current && boardRef.current.querySelector(`[data-pos="${r}-${c}"]`);
    if (!el) return null;
    const boardRect = boardRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    return { x: rect.left - boardRect.left, y: rect.top - boardRect.top, w: rect.width, h: rect.height };
  }

  function renderCell(r, c, piece) {
    const isSelected = selected && selected.r === r && selected.c === c;
    const isMarked = marks.some(m => m.r === r && m.c === c);
    const isChecked = checkedPos && checkedPos.r === r && checkedPos.c === c;
    const isLastFrom = lastMove && lastMove.from.r === r && lastMove.from.c === c;
    const isLastTo = lastMove && lastMove.to.r === r && lastMove.to.c === c;
    const isCapture = isLastTo && !!lastMove.captured;
    const isPalace = c >= 3 && c <= 5 && (r <= 2 || r >= 7);
    return (
      <Cell
        key={`${r}-${c}`}
        dataPos={`${r}-${c}`}
        piece={piece}
        isPalace={isPalace}
        isSelected={isSelected}
        isMarked={isMarked}
        isChecked={isChecked}
        isLastFrom={isLastFrom}
        isLastTo={isLastTo}
        isCapture={isCapture}
        onClick={() => onCellClick(r, c)}
      />
    );
  }

  return (
    <div id="board" ref={boardRef}>
      {displayBoard.slice(0, 5).map((row, r) => row.map((piece, c) => renderCell(r, c, piece)))}
      <div className="river">
        <span className="river-text">楚河</span>
        <span className="river-text">汉界</span>
      </div>
      {displayBoard.slice(5).map((row, r) => row.map((piece, c) => renderCell(r + 5, c, piece)))}
      <svg className="board-lines" viewBox={`0 0 ${geo.w} ${geo.h}`}>
        {palaces.map((p, i) => {
          const cx = geo.cell / 2;
          return (
            <g key={i}>
              <rect x={p.x} y={p.y} width={p.w} height={p.h} className="palace-line" />
              <line x1={p.x + cx} y1={p.y + cx} x2={p.x + p.w - cx} y2={p.y + p.h - cx} className="palace-line" />
              <line x1={p.x + p.w - cx} y1={p.y + cx} x2={p.x + cx} y2={p.y + p.h - cx} className="palace-line" />
            </g>
          );
        })}
      </svg>
      {animPiece && animPos && (
        <div
          ref={floatRef}
          className={`floating-piece ${animPiece.piece.color}`}
          style={{
            left: animPos.from.x,
            top: animPos.from.y,
            width: animPos.from.w,
            height: animPos.from.h,
          }}
        >
          {animPiece.piece.label}
        </div>
      )}
    </div>
  );
}
