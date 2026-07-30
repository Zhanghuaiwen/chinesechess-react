import Cell from './Cell';

export default function Board({ board, selected, marks, onCellClick }) {
  return (
    <div id="board">
      {board.map((row, r) =>
        row.map((piece, c) => {
          const isSelected = selected && selected.r === r && selected.c === c;
          const isMarked = marks.some(m => m.r === r && m.c === c);
          return (
            <Cell
              key={`${r}-${c}`}
              piece={piece}
              isSelected={isSelected}
              isMarked={isMarked}
              onClick={() => onCellClick(r, c)}
            />
          );
        })
      )}
    </div>
  );
}
