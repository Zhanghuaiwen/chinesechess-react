# 04 联机服务端：权威状态机、断线重连、ELO 与账号

## 1. 进程与入口

文件：[server/src/index.ts](../server/src/index.ts)

```text
createServer(HTTP)
  ├─ GET /health  → { ok, service, rooms: 'in-memory', queue }
  └─ 其他路径     → 404

WebSocketServer({ server })
  connection → ws.on('message') → handleMessage(ws, raw)
               ws.on('close')   → handleClose(ws)
               ws.on('error')   → 仅日志

http.listen(PORT=8787, HOST=0.0.0.0)
  → matchmaker.start()（1 秒 tick）
  → SIGINT/SIGTERM 优雅关闭，2 秒兜底 exit
```

- 端口、宽限期、数据文件都可通过环境变量覆盖：`PORT`、`RECONNECT_GRACE_MS`、`RATINGS_FILE`、`ACCOUNTS_FILE`。
- 冒烟测试用它做隔离实例（8799/8801）和短宽限期（2000ms）。

---

## 2. 房间与对局状态机

### 2.1 两个状态维度

对局状态（`Game.status`）：

```text
waiting ──(第二人入座)──► playing ──(终局)──► over
```

座位连接状态（`Player.ws / offlineUntil`）：

```text
online ──(连接关闭)──► offline(宽限期) ──(回连)──► online
                                      └─(超时)──► 对局中判负 / 等待中释放座位
```

这两个维度正交：`playing` 期间可以有一个座位 `offline`，对局不被暂停，对手仍可走子。

### 2.2 房间生命周期

[server/src/store.ts](../server/src/store.ts) `joinRoom` L25：

```text
rooms.get(roomId)
  ├─ 不存在 / 已满 / 已结束 → new Game(roomId)，写入 rooms + games
  └─ 可加入 → 复用
game.seat(ws, name)
```

- 房间号复用：一局结束后，同一个 roomId 会创建新 Game，而不是重置旧 Game。
- `games` 以 `gameId` 为键，供 `room.resume` / `game.move` 精确定位。
- `rooms` 以 `roomId` 为键，供房间加入。

回收 `reap` L60：

```text
done = status over || playerCount == 0
if done && 所有座位都离线:
    games.delete(gameId)
    rooms.delete(roomId)  // 仅当 rooms 里还是这局
```

### 2.3 `applyMove` 的六道校验

[server/src/room.ts](../server/src/room.ts) L234：

```text
1. status === 'playing'          → 否则 not_playing
2. player.color === turn          → 否则 not_your_turn
3. baseSeq === seq                → 否则 stale_seq
4. board[from] 存在且颜色匹配      → 否则 no_piece
5. to ∈ getSafeMoves(board, from) → 否则 illegal_move
6. 全部通过 → 落子、seq+1、换手、记谱、判终局
```

关键设计：

- **绝不部分改状态**：任何一步失败都直接返回，不修改棋盘/序号。
- **服务端重算合法着法**：不信任客户端提交的“这步合法”。
- **递增 seq**：既是版本号，也是走子历史序号；客户端据此对齐。
- **先判吃将，再判无着，再判重复**：顺序影响 reason 的准确性。

### 2.4 终局统一出口

`endGame(winnerColor, reason)` L308：

```text
status = over
winnerColor = winnerColor
winner = winnerColor ? '红方'/'黑方' : null
reason = reason
onEnd?.(this)          // 排位局由 Matchmaker 注入 settle
return game.over 消息
```

为什么用回调而不是直接依赖 `Matchmaker`：

- `Game` 只关心对局规则，不关心排位；
- 休闲房局 `onEnd = null`，排位局才挂结算；
- 避免 `room.ts ↔ matchmaker.ts` 循环依赖。

---

## 3. 乐观并发：`baseSeq`

### 3.1 为什么需要

网络是异步的，双方可能同时基于不同版本提交：

```text
服务端 seq=7
A 基于 7 提交 → 接受，seq=8
B 仍基于 7 提交 → 若接受，就会出现两个“第 8 手”
```

`baseSeq` 的作用：**把“最后写入获胜”改成“基于旧版本的写入被拒绝”**。

### 3.2 冲突后的自愈

```text
B 收到 game.move.rejected(seq=8, reason=stale_seq)
  → 前端提示“状态已更新，已为你重新同步”
  → 立即 sync.request
  → 收 game.state(seq=8)
  → 本地棋盘/回合/棋谱全部对齐
```

### 3.3 为什么不是严格锁

- 象棋是回合制，同一时刻只有一方能走，真正并发写入很少；
- 严格锁需要额外的锁状态、超时、释放协议；
- 乐观并发 + 版本号足够，且失败成本低（重发一次即可）。

### 3.4 消息顺序的实际影响

`applyMove` 成功后，网关的发送顺序是：

```text
1. game.move.accepted → 只发给走子方
2. game.state         → 广播双方（全量快照）
3. game.over          → 若终局，广播
```

而排位结算 `rating.update` 是在 `endGame` 内、由 `onEnd` 同步触发的，所以实际到达顺序可能是：

```text
rating.update → game.move.accepted → game.state → game.over
```

客户端目前把 `rating.update` 当作独立面板数据，不依赖它先于/后于终局，所以没有 bug；但更严谨的做法是把结算结果并入快照，或把 `rating.update` 放到 `game.over` 之后发送。这是可以主动说出的“消息时序优化点”。

---

## 4. 断线重连（P2 的核心）

### 4.1 服务端：保留座位，不暂停对局

`handleClose` L286：

```text
matchmaker.remove(ws)          // 排队中掉线先出队，避免幽灵匹配
game = findGameBySocket(ws)
player = game.playerBySocket(ws)
game.markOffline(player)       // ws=null, offlineUntil=now+graceMs
clearTimeout(旧定时器)
setTimeout(graceMs):
    expireOffline(player)
    broadcastSnapshot()
    if (over) broadcast(over)
    store.reap(game)
broadcastSnapshot()            // 立刻让对手看到离线倒计时
```

`expireOffline` L177：

```text
if (player.ws) return null           // 已回连，忽略
if (status === 'playing') → 判对手胜，reason='disconnect'
if (status === 'waiting') → 从座位列表移除
```

### 4.2 客户端：凭据 + 指数退避

- `sessionId` 存 `sessionStorage`：刷新页面仍在，关闭标签页即失效。
- 重连成功后发 `room.resume { gameId, sessionId }`。
- 服务端命中后：关闭旧连接、清定时器、`reattach`、回 `room.joined` + 全量快照。
- 重连退避：1/2/4/8/16 秒，最多 8 次；心跳 15 秒，40 秒无 pong 判死。

### 4.3 为什么用全量快照恢复

- 服务端不需要保存“每个客户端已确认到第几手”；
- 客户端不需要实现 replay/补偿；
- 一次 `game.state` 就能对齐棋盘、回合、棋谱、seq、离线信息、排位信息。

代价是带宽略大，但棋盘 10×9 的对象数组只有几 KB，完全可接受。

### 4.4 旧连接残留

`room.resume` L97：

```text
if (player.ws && player.ws !== ws) player.ws.close()
```

为什么要主动关闭旧连接：

- 网络抖动/多标签可能导致同一 `sessionId` 有两个连接；
- 不关闭会出现“两个 socket 都认为自己在线”，走子归属不确定；
- 关闭后旧连接的 `close` 事件里 `findGameBySocket` 已找不到它（`player.ws` 已指向新连接），不会误判离线。

### 4.5 宽限期的边界

| 场景 | 当前行为 | 评价 |
| --- | --- | --- |
| 对局中断线 10 秒回连 | 座位保留，继续下 | 正确 |
| 对局中断线 31 秒 | 判负，`reason=disconnect` | 可接受 |
| 等待中掉线，30 秒内第二人加入 | 第二人会和“离线玩家”开局，随后离线方超时判负 | **体验问题**：等待态应更快释放座位或阻止开局 |
| 刷新页面 | `sessionStorage` 保留，可恢复 | 正确 |
| 关闭标签页再开新标签 | `sessionStorage` 丢失，无法恢复 | 设计取舍；要跨标签需 `localStorage` + 更严格防多开 |

---

## 5. 匹配与 ELO

### 5.1 队列策略

[server/src/matchmaker.ts](../server/src/matchmaker.ts)：

```text
join: 去重 → ratings.get 建档 → 入队 → 立即 notify → tryMatch
tick(每 1 秒):
  更新每个人的 band，变化则 notify
  tryMatch
```

`bandOf` L68：

```text
等待 < 30 秒：
  band = min(800, 100 + floor(等待秒数 / 5) * 100)
等待 >= 30 秒：
  band = 无限（HARD_WAIT）
```

`tryMatch` L96：

```text
按 joinedAt 升序
为最早等待的人 a 找对手：
  跳过自己
  跳过相同 playerId（防止自匹配）
  要求 diff <= min(bandA, bandB)
  取 diff 最小者
命中 → 从队列移除两人 → startRanked → 递归撮合剩余
```

为什么双方 band 取 `min`：

- 如果只要求“a 的 band 覆盖 b”，等待久的人会单方面拉大分差；
- 取 `min` 保证双方都觉得这个对局可接受。

### 5.2 排位局创建

```text
store.createRanked()          // roomId = ranked-xxxxxx，不挂 rooms
game.seat(a, {playerId, rating})
game.seat(b, ...)
game.onEnd = settle
match.found（各自 youAre/sessionId/opponent）
game.broadcastSnapshot()
```

### 5.3 Elo 计算

[server/src/rating.ts](../server/src/rating.ts)：

```text
E(A) = 1 / (1 + 10^((Rb - Ra) / 400))
delta = round(K * (scoreA - E(A)))
A' = Ra + delta
B' = Rb - delta          // 零和
K = 32
```

例子：

| Ra | Rb | 结果 | E(A) | delta |
| --- | --- | --- | --- | --- |
| 1200 | 1200 | A 胜 | 0.5 | +16 |
| 1200 | 1200 | 和 | 0.5 | 0 |
| 1200 | 1200 | A 负 | 0.5 | -16 |
| 1400 | 1200 | A 胜 | 0.76 | +8 |
| 1200 | 1400 | A 胜 | 0.24 | +24 |

零和的好处：总分守恒，不会通货膨胀；坏处：新手被高手吃分时掉分快，缺少 provisional/K 衰减。

### 5.4 结算与推送

`settle` L162：

```text
seats = 有 playerId 的座位（必须 2 个）
scoreA = winnerColor === null ? 0.5 : a.color === winnerColor ? 1 : 0
ratings.settle(a.playerId, b.playerId, scoreA)
更新内存座位 rating
按 A 的结果映射 B 的 result
rating.update 分别发给在线座位
```

注意：断线判负的排位局也会结算；如果败方已断线，他的 `rating.update` 不会推送，但分数已经落盘，重连后 `profile.get` 能看到。

### 5.5 匹配的已知限制

- 没有分段位/赛季/定级赛；
- 没有防止“刷分/送分”的对手重复检测；
- 没有地区/延迟维度；
- `tryMatch` 是 O(n²) 扫描，队列很大时需要分桶；
- 匹配成功后才创建 Game，取消匹配只移除队列。

---

## 6. 账号与会话安全

文件：[server/src/accounts.ts](../server/src/accounts.ts)

### 6.1 密码

```text
salt = randomBytes(16).hex
hash = scryptSync(password, salt, 64).hex
```

- 不用明文、不用 md5/sha1；
- 登录时重新派生，`timingSafeEqual` 比较，避免时序侧信道；
- 代价：`scryptSync` 是同步阻塞，登录请求会短暂占用事件循环；高并发应改异步 `scrypt` + 限流。

### 6.2 令牌

```text
token = randomBytes(32).hex         // 下发给客户端
存储 = sha256(token)                // 文件里只有摘要
TTL = 30 天
```

- 即使 `accounts.json` 泄露，攻击者也不能直接拿摘要当令牌；
- `logout` 只删当前 token 的摘要，多设备互不影响；
- 过期 token 在 `verify` 时顺手清理。

### 6.3 身份优先级

```text
match.join / profile.get:
  account = accounts.verify(token)
  playerId = account ? account.playerId : 客户端自报 playerId
  name     = account ? account.displayName : 客户端自报 name
```

安全含义：

- 登录态下**不能**冒用他人 `playerId` 或改名；
- 游客态下 `playerId` 是客户端自报的，**可以被伪造**。这是匿名模式的固有限制，排行榜只适合演示/朋友局。

### 6.4 游客战绩迁移

`auth.register` 时：

```text
ratings.transfer(guestId, account.playerId)
```

规则：

- 来源必须有战绩（`games > 0`）；
- 目标必须没有战绩（`games === 0`），避免覆盖已有分数；
- 迁移是“移动”而不是“复制”，来源档案删除。

---

## 7. 持久化与内存

### 7.1 两个 JSON 文件

| 文件 | 内容 | 写入时机 |
| --- | --- | --- |
| `server/data/ratings.json` | 排位档案数组 | 新建档案、改名、结算、迁移 |
| `server/data/accounts.json` | 账号 + 会话 | 注册、登录、登出、过期清理 |

- 启动时同步读取；写入用 `writeFileSync`。
- 没有事务、没有 WAL、没有锁；单进程下可用，多进程会互相覆盖。
- 写入失败只打日志，不抛出，保证对局不因持久化失败而中断。

### 7.2 内存注册表

- `rooms: Map<roomId, Game>`
- `games: Map<gameId, Game>`
- `Matchmaker.queue: Entry[]`

这些都不落盘，进程重启即丢失。这是“演示项目”和“生产系统”的最大分界线。

### 7.3 回收策略

- 对局结束且所有连接离线 → `reap`；
- 等待中没有座位 → `reap`；
- 结束但仍有连接 → 保留到该连接关闭后的宽限期结束；
- 匹配队列断线立即移除。

潜在问题：

- `findGameBySocket` 是 O(对局数) 线性扫描；
- 同一 socket 重进房间时，旧 `Game` 仍持有该 socket 引用，可能导致关闭事件只命中旧局（已知边界，见 8.3）。

---

## 8. 健壮性、安全与已知问题

### 8.1 已经做的校验

- `parse` 包 try/catch，坏 JSON 不会崩；
- `roomId` 必须是字符串、trim 后 ≤32；
- `name` 归一化为 `string | undefined`，避免非字符串触发 `trim` 崩溃；
- `isCell` 检查整数、0≤r<10、0≤c<9；
- `baseSeq` 必须是 number；
- 账号字段类型校验、长度/格式校验；
- 引擎 MultiPV 钳制、请求超时、崩溃重建。

### 8.2 仍然存在的风险

| 风险 | 说明 | 改进 |
| --- | --- | --- |
| 无统一 dispatch try/catch | 某个分支内意外抛错仍可能崩进程 | 在 `handleMessage` 外层包 try/catch |
| 无 Origin 校验 | 任意网页可连 WS | 校验 `Origin` 白名单 |
| 无速率限制 | 登录、建房、走子、分析都可被刷 | token bucket / IP 限流 |
| 无 TLS | 明文 WS | 生产用 wss + 反代 |
| 游客身份可伪造 | 自报 playerId | 强制登录或签名身份 |
| `sync.request` 不验证成员 | 知道 gameId 就能拿快照 | 校验 `playerBySocket` |
| `scryptSync` 阻塞 | 登录峰值卡事件循环 | 异步 scrypt + 队列 |
| JSON 同步写 | 磁盘慢时阻塞 | 原子写 + 异步队列/数据库 |
| 单进程内存 | 不能多实例 | Redis 房间状态 + 发布订阅 |
| 无观战/聊天/求和 | 功能缺口 | 按产品优先级补 |

### 8.3 两个值得主动说的边界问题

1. **等待态断线仍保留座位**：第二人可能在宽限期内加入，随后离线方超时判负。更合理的是等待态立即释放座位，或把房间标记为“不可加入”。
2. **同一 socket 重进同一房间**：旧 `Game` 仍持有该 socket，`findGameBySocket` 可能命中旧局，导致新局的离线标记丢失。修复思路：socket → game 建一对一索引，进新局时从旧局解绑。

---

## 9. 验证与测试

| 脚本 | 覆盖 | 运行前置 |
| --- | --- | --- |
| [smoke.mjs](../server/scripts/smoke.mjs) | P0：房间、走子、拒绝、认输、快照 | 8787 已启动 |
| [smoke-p1.mjs](../server/scripts/smoke-p1.mjs) | P1：匹配、ELO、排行榜、档案 | 自建 8799 隔离实例 |
| [smoke-p2.mjs](../server/scripts/smoke-p2.mjs) | P2：重连、伪造 sessionId、超时判负 | 8787；建议 `RECONNECT_GRACE_MS=2000` |
| [smoke-auth.mjs](../server/scripts/smoke-auth.mjs) | P4：注册、登录、令牌、游客迁移 | 自建 8801 隔离实例 |

共 74 项断言（13 + 26 + 13 + 22）。

这些脚本是“协议级”的：直接开多个 WebSocket，发真实消息，断言服务端响应和状态。它们比单元测试更接近真实联机，也更容易在面试时讲“我怎么验证分布式状态”。

---

## 10. 生产化改造清单（面试加分）

1. **状态外置**：房间/对局 → Redis；排位/账号 → Postgres；用 Lua/事务保证 `seq` 原子递增。
2. **多实例**：WS 网关无状态，房间通过 Redis Pub/Sub 广播；或按 `roomId` 做一致性哈希 + sticky。
3. **消息幂等**：`gameId + seq + playerId` 做去重键，客户端重试不会重复落子。
4. **可观测性**：连接数、房间数、队列长度、走子拒绝率、引擎 P95、重连成功率。
5. **安全**：wss、Origin 白名单、限流、登录失败锁定、令牌轮换。
6. **引擎独立服务**：进程池 + 请求队列 + 超时/熔断，不占用 WS 进程。
7. **对局恢复**：定期快照到 Redis，服务重启后可恢复进行中的对局。
8. **规则完整度**：长将/长捉、自然限着、完整记谱消歧。
