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

  const save = () => {
    if (moves.length === 0) return;
    const lines = [];
    for (let i = 0; i < moves.length; i += 2) {
      const red = moves[i].notation;
      const black = moves[i + 1] ? moves[i + 1].notation : '…';
      lines.push(`${i / 2 + 1}. ${red.padEnd(6, '　')} ${black}`);
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[:T]/g, '-')
      .slice(0, 19);
    const blob = new Blob([`[中国象棋 棋谱]\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `棋谱_${stamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
      <button className="save-btn" onClick={save} disabled={moves.length === 0}>
        保存棋谱
      </button>
    </div>
  );
}
