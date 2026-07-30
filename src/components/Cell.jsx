export default function Cell({ piece, isSelected, isMarked, onClick }) {
  let className = 'cell';
  if (piece) {
    className += ` ${piece.color}`;
  } else {
    className += ' empty';
  }
  if (isSelected) className += ' selected';
  if (isMarked) className += ' mark';

  return (
    <div className={className} onClick={onClick}>
      {piece ? piece.label : ''}
    </div>
  );
}
