import { evaluateBoard } from "../utils/gameLogic";

export default function StatsPanel({ board, stats }) {
  const evalScore = evaluateBoard(board);

  return (
    <div style={{ display: "flex", alignItems: "center", height: "100vh" }}>
      <div className="stats-panel">
        <div className="stats-header">对局数据</div>

        <div className="stats-sub">本次搜索</div>
        <div className="stat-row">
          <span className="stat-label">当前思考节点数</span>
          <span className="stat-value">{stats.lastNodes}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">当前剪枝数</span>
          <span className="stat-value">{stats.lastPrunes}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">搜索深度</span>
          <span className="stat-value">{stats.lastDepth}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">搜索耗时</span>
          <span className="stat-value">{stats.lastTimeMs} ms</span>
        </div>

        <div className="stats-sub">累计</div>
        <div className="stat-row">
          <span className="stat-label">总思考节点数</span>
          <span className="stat-value">{stats.nodes}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">Alpha-Beta剪枝总数</span>
          <span className="stat-value">{stats.prunes}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">AI走棋次数</span>
          <span className="stat-value">{stats.moves}</span>
        </div>
        <div className="stat-row">
          <span className="stat-label">棋盘价值</span>
          <span className="stat-value">{evalScore}</span>
        </div>

        <div className="stat-note">棋盘价值: 正值红方占优，负值黑方占优</div>
      </div>
    </div>
  );
}
