import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const colLeft = c => PAD + c * (CELL + GAP);
const rowTop = r => (r <= 4
  ? PAD + r * (CELL + GAP)
  : PAD + 5 * CELL + 5 * GAP + RIVER_H + GAP + (r - 5) * (CELL + GAP));

const PALACE_W = 3 * CELL + 2 * GAP;
const PALACES = [
  { x: colLeft(3), y: rowTop(0), w: PALACE_W, h: PALACE_W },
  { x: colLeft(3), y: rowTop(7), w: PALACE_W, h: PALACE_W },
];

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
  const checkedPos = check ? findKing(board, check) : null;

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
      <svg className="board-lines" viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}>
        {PALACES.map((p, i) => {
          const cx = CELL / 2;
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
