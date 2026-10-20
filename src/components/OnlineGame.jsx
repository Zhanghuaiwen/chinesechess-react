import { useState } from 'react';
import Board from './Board';
import MoveList from './MoveList';
import useOnlineGame from '../hooks/useOnlineGame';

const CONN_LABEL = {
  idle: '未连接',
  connecting: '连接中…',
  open: '已连接',
  reconnecting: '重连中…',
  closed: '连接已断开',
};

const colorLabel = (c) => (c === 'red' ? '红方' : c === 'black' ? '黑方' : '—');

/** 联机对战面板：大厅 -> 房间 -> 对局，全部走服务端权威状态。 */
export default function OnlineGame({ onExit }) {
  const g = useOnlineGame();
  const [rid, setRid] = useState('');
  const [name, setName] = useState('');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');

  // 角落 uid 角标：登录后显示账号的固定 uid，否则显示游客本机 uid
  const uidBadge = (
    <div className="uid-badge" title={`uid: ${g.uid}`}>
      uid {String(g.uid).slice(0, 8)}
      {g.account ? ' · 账号' : ' · 游客'}
    </div>
  );

  // 排行榜（大厅展示 Top 10，随连接自动拉取）
  const leaderboardBlock = g.leaderboard && (
    <div className="online-lb">
      <div className="online-lb-title">排行榜 Top {g.leaderboard.length}</div>
      {g.leaderboard.length === 0 ? (
        <div className="online-lb-empty">暂无排位记录，打完一局随机匹配后出现</div>
      ) : (
        g.leaderboard.map((row, i) => (
          <div key={`${row.name}-${i}`} className="online-lb-row">
            <span className="online-lb-rank">{i + 1}</span>
            <span className="online-lb-name">{row.name}</span>
            <span className="online-lb-score">{row.rating}</span>
          </div>
        ))
      )}
    </div>
  );

  if (g.phase === 'resuming') {
    return (
      <div className="online-lobby">
        {uidBadge}
        <div className="online-card">
          <div className="online-card-title">恢复对局</div>
          <div className="online-card-sub">正在凭会话凭据恢复你的座位</div>
          <div className={`online-conn ${g.conn}`}>连接状态：{CONN_LABEL[g.conn]}</div>
          <div className="online-log">{g.log}</div>
          <button className="online-ghost" onClick={g.leaveRoom}>
            放弃恢复，返回大厅
          </button>
        </div>
      </div>
    );
  }

  if (g.phase === 'queuing') {
    return (
      <div className="online-lobby">
        {uidBadge}
        <div className="online-card">
          <div className="online-card-title">随机匹配</div>
          <div className="online-card-sub">正在寻找实力相近的对手…</div>

          <div className="online-queue">
            <div className="online-queue-rating">
              我的排位分 <b>{g.myRating ?? '—'}</b>
            </div>
            {g.queue && (
              <div className="online-queue-meta">
                队列 {g.queue.waiting} 人 · 分段区间 {g.queue.band == null ? '不限' : `±${g.queue.band}`}
              </div>
            )}
            <div className="online-spinner" />
          </div>

          <div className={`online-conn ${g.conn}`}>连接状态：{CONN_LABEL[g.conn]}</div>
          <div className="online-log">{g.log}</div>

          <button className="online-ghost" onClick={g.cancelMatch}>
            取消匹配
          </button>
        </div>
      </div>
    );
  }

  if (g.phase === 'lobby') {
    const rating = g.profile?.rating ?? g.myRating;
    return (
      <div className="online-lobby">
        {uidBadge}
        <div className="online-card">
          <div className="online-card-title">联机对战</div>
          <div className="online-card-sub">随机匹配，或与好友约定房间号开局</div>

          <div className="online-rating">
            <span>我的排位分</span>
            <b>{rating ?? '—'}</b>
            {g.profile && (
              <span className="online-rating-sub">
                {g.profile.wins}胜 {g.profile.losses}负 {g.profile.draws}和 · 共 {g.profile.games} 局
              </span>
            )}
          </div>

          {/* 账号：登录后分数跨浏览器保留；不登录仍可以游客身份开局 */}
          <div className="online-auth">
            {g.account ? (
              <div className="online-auth-row">
                <span className="online-auth-name">已登录：{g.account.name}</span>
                <button className="online-ghost online-auth-mini" onClick={g.logout}>
                  退出登录
                </button>
              </div>
            ) : (
              <>
                <div className="online-auth-title">登录账号（分数跨设备保留）</div>
                <div className="online-auth-grid">
                  <input
                    value={authUser}
                    onChange={(e) => setAuthUser(e.target.value)}
                    placeholder="用户名"
                    maxLength={20}
                    autoComplete="username"
                  />
                  <input
                    type="password"
                    value={authPass}
                    onChange={(e) => setAuthPass(e.target.value)}
                    placeholder="密码（至少 6 位）"
                    maxLength={64}
                    autoComplete="current-password"
                  />
                </div>
                <div className="online-auth-actions">
                  <button
                    className="online-primary"
                    disabled={!authUser.trim() || !authPass}
                    onClick={() => g.login(authUser, authPass)}
                  >
                    登录
                  </button>
                  <button
                    className="online-ghost"
                    disabled={!authUser.trim() || !authPass}
                    onClick={() => g.register(authUser, authPass, name)}
                  >
                    注册
                  </button>
                </div>
                <div className="online-auth-hint">
                  不登录也能玩：游客分数只保存在本机浏览器，注册可把当前游客战绩并入账号
                </div>
                {g.authError && <div className="online-auth-error">{g.authError}</div>}
              </>
            )}
          </div>

          {leaderboardBlock}

          {!g.account && (
            <label className="online-field">
              <span>昵称</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="可留空"
                maxLength={12}
              />
            </label>
          )}

          <button className="online-primary" onClick={() => g.findMatch(name)}>
            随机匹配
          </button>

          <div className="online-divider-or">
            <span>或 房间号好友对战</span>
          </div>

          <label className="online-field">
            <span>房间号</span>
            <input
              value={rid}
              onChange={(e) => setRid(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && g.joinRoom(rid, name)}
              placeholder="例如 8888"
              maxLength={32}
            />
          </label>

          <button className="online-primary online-secondary" onClick={() => g.joinRoom(rid, name)}>
            进入房间
          </button>

          <div className={`online-conn ${g.conn}`}>连接状态：{CONN_LABEL[g.conn]}</div>
          <div className="online-log">{g.log}</div>

          {onExit && (
            <button className="online-ghost" onClick={onExit}>
              返回单机对战
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="online-layout">
      {uidBadge}
      <div className="online-side">
        <div className="online-side-title">对局信息</div>
        <div className="online-row">
          <span>{g.ranked ? '对局类型' : '房间号'}</span>
          <b>{g.ranked ? '排位赛' : g.roomId}</b>
        </div>
        <div className="online-row">
          <span>我执</span>
          <b className={g.youAre}>{colorLabel(g.youAre)}</b>
        </div>
        <div className="online-row">
          <span>当前回合</span>
          <b className={g.turn}>{colorLabel(g.turn)}</b>
        </div>
        <div className="online-row">
          <span>连接</span>
          <b className={g.conn}>{CONN_LABEL[g.conn]}</b>
        </div>
        {g.ranked && (
          <>
            <div className="online-row">
              <span>我的评分</span>
              <b>{g.myRating ?? '—'}</b>
            </div>
            <div className="online-row">
              <span>对手评分</span>
              <b>{g.opponent?.rating ?? '—'}</b>
            </div>
          </>
        )}

        {g.offline && (
          <div className={`online-offline ${g.offline.color === g.youAre ? 'self' : 'opp'}`}>
            {g.offline.color === g.youAre
              ? '你已断线，正在尝试重连'
              : `对手已断线，等待重连（${g.offlineRemaining}s）`}
          </div>
        )}

        <div className="online-divider" />
        <div className="online-side-sub">对局双方</div>
        {g.players.length === 0 && <div className="online-empty">暂无其他玩家</div>}
        {g.players.map((p) => (
          <div key={p.id} className={`online-player ${p.color}`}>
            <span className="online-player-name">{p.name}</span>
            {p.rating != null && <span className="online-player-rating">{p.rating}</span>}
            <span className="online-player-color">{p.color === 'red' ? '红' : '黑'}</span>
            {p.color === g.youAre && <span className="online-player-you">你</span>}
            <span className={`online-player-conn ${p.connected ? 'on' : 'off'}`}>
              {p.connected ? '在线' : '离线'}
            </span>
          </div>
        ))}

        <div className="online-actions">
          <button className="online-primary" onClick={g.resign} disabled={g.phase !== 'playing'}>
            认输
          </button>
          <button className="online-ghost" onClick={g.leaveRoom}>
            离开房间
          </button>
        </div>

        <div className="online-log">{g.log}</div>
      </div>

      <div className="container">
        <div className="header">
          <span>联机对战</span>
          <span className="header-right">
            {g.check && <span className="check-badge">将军！</span>}
            <span className={`turn-label ${g.turn}`}>{g.turn === 'red' ? '红' : '黑'}</span>
          </span>
        </div>

        {g.phase === 'over' && (
          <div className="game-over">{g.winner ? `${g.winner}胜利` : '和棋'}</div>
        )}

        {g.phase === 'over' && g.ratingResult && (
          <div className={`online-rating-result ${g.ratingResult.result}`}>
            <span className="online-rating-verdict">
              {g.ratingResult.result === 'win' ? '胜利' : g.ratingResult.result === 'loss' ? '失败' : '和棋'}
            </span>
            <span className="online-rating-delta">
              排位分 {g.ratingResult.you.before} → {g.ratingResult.you.rating}
              （{g.ratingResult.you.delta >= 0 ? '+' : ''}{g.ratingResult.you.delta}）
            </span>
          </div>
        )}

        <div className="board-wrap">
          <Board
            board={g.board}
            selected={g.selected}
            marks={g.marks}
            check={g.check}
            lastMove={g.lastMove}
            moveSeq={g.moveSeq}
            onCellClick={g.onCellClick}
            onAnimatingChange={() => {}}
          />
          {g.phase === 'waiting' && (
            <div className="board-overlay">
              <div className="board-overlay-text">等待对手加入</div>
              <div className="online-roomcode">房间号 {g.roomId}</div>
            </div>
          )}
        </div>

        <div id="log">{g.log}</div>
      </div>

      <MoveList moves={g.moves} activeIndex={-1} onReplayToMove={() => {}} />
    </div>
  );
}
