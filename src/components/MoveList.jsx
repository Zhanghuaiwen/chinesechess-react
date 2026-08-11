export default function MoveList({ moves, activeIndex, onReplayToMove }) {
  const rows = [];
  for (let i = 0; i < moves.length; i += 2) {
    rows.push(
      <div className="move-row" key={i}>
        <span className="move-no">{i / 2 + 1}.</span>
        <button
          className={`move-btn ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onReplayToMove(i)}
        >
          {moves[i].notation}
        </button>
        {moves[i + 1] ? (
          <button
            className={`move-btn ${i + 1 === activeIndex ? 'active' : ''}`}
            onClick={() => onReplayToMove(i + 1)}
          >
            {moves[i + 1].notation}
          </button>
        ) : (
          <span className="move-btn placeholder" />
        )}
      </div>
    );
  }

  return (
    <div className="move-list">
      <div className="move-list-title">棋谱（点击回放）</div>
      <div className="move-list-rows">
        {moves.length === 0 ? (
          <div className="move-list-empty">尚无走子记录</div>
        ) : (
          rows
        )}
      </div>
    </div>
  );
}
