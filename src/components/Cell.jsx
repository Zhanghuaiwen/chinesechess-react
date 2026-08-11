export default function Cell({ dataPos, isPalace, piece, isSelected, isMarked, isChecked, isLastFrom, isLastTo, isCapture, onClick }) {
  let className = 'cell';
  if (isPalace) className += ' palace';
  if (piece) {
    className += ` ${piece.color}`;
  } else {
    className += ' empty';
  }
  if (isSelected) className += ' selected';
  if (isMarked) className += ' mark';
  if (isChecked) className += ' checked';
  if (isLastFrom) className += ' last-from';
  if (isLastTo) className += ' last-to';
  if (isCapture) className += ' capture';

  return (
    <div className={className} data-pos={dataPos} onClick={onClick}>
      {piece ? piece.label : ''}
    </div>
  );
}
