# P4 全量代码复盘 —— 去冗余 + 修 Bug

## 目标与边界（用户原话）
> 「重点想过一遍所有代码 把冗余的或者不必要的优化一部分 另外改些bug 至于性能和安全上的优化先不考虑」

- 做：删除冗余/死代码/重复实现（重构必须**行为等价**）；修真实 bug。
- 不做：性能优化、安全加固；不新增功能；不引入新依赖。
- 前提：P0–P3 已上线且冒烟全绿，任何改动都要能回归。

## 影响面
仅本仓库源码文件；不涉及协议字段增删（除内部类型），前端可见行为除 F1 修正外不变。

---

## 一、后端（server/src）

### B1 真实 bug：`room.join` 的 `name` 未做类型校验 → 脏输入可崩溃
- 位置：[gateway.ts](../server/src/gateway.ts#L45) `store.joinRoom(roomId, ws, msg.name)`
- 传导链：`Game.seat()`（[room.ts](../server/src/room.ts#L121)）执行 `name?.trim() || colorName(color)`；当客户端发 `{t:'room.join',roomId:'x',name:123}` 时 `123?.trim` 为 `undefined`，调用即抛 `TypeError`。
- 后果：`handleMessage` 外层无 try/catch，异常冒泡到 `ws.on('message')`，进程崩溃。与文件顶部「所有入口都做形状校验」的承诺相悖。
- 修复：

```ts
const name = typeof msg.name === 'string' ? msg.name : undefined;
const { game, player } = store.joinRoom(roomId, ws, name);
```
- 风险：低（仅收紧非法入参）。

### B2 死代码：`gateway.ts` 多余重导出
- 位置：[gateway.ts](../server/src/gateway.ts#L256) `export type { ServerMessage };`
- 证据：全仓库 grep 无任何 `import { ServerMessage } from './gateway'`。
- 修复：删除该行，并把 import 改为 `import type { ClientMessage } from './protocol.js';`（正文未使用 `ServerMessage`）。
- 风险：低。

### B3 死代码：`Game.start()` 无调用方
- 位置：[room.ts](../server/src/room.ts#L307-L309)
- 证据：`seat()` 已在满员时置 `status='playing'`（[room.ts](../server/src/room.ts#L128)）；grep 全仓库仅 `matchmaker.start()` 被调用。
- 修复：删除该方法。
- 风险：低。

### B4 冗余计算：`MoveOutcome.snapshot` 从未被消费
- 位置：接口 [room.ts](../server/src/room.ts#L47-L52) 字段 `snapshot`；赋值 [room.ts](../server/src/room.ts#L295) `snapshot: this.snapshotFor(null)`
- 证据：`gateway.ts` 的 `game.move` 分支只用 `ok / accepted / gameOver / reason`（[gateway.ts](../server/src/gateway.ts#L132-L146)），从不读 `outcome.snapshot`；每次落子白白构造一份完整快照。
- 修复：删除 `MoveOutcome.snapshot` 字段与该赋值；快照仍由 gateway 的 `broadcastSnapshot()` 广播，行为不变。
- 风险：低（内部类型，无外部引用）。

### B5 冗余：`Matchmaker.stop()` 无调用方
- 位置：[matchmaker.ts](../server/src/matchmaker.ts#L40-L45)
- 证据：仅 `start()` 被 `index.ts` 调用。
- 修复：删除该方法。
- 风险：低（若将来需要优雅停机再按需加回）。

### B6 冗余：`RatingsStore.size` getter 无调用方
- 位置：[ratings.ts](../server/src/ratings.ts#L117-L119)
- 证据：grep 无 `ratings.size`。
- 修复：删除该 getter。
- 风险：低。

### B7 冗余：`JoinResult.roomId` 无消费方
- 位置：[store.ts](../server/src/store.ts#L9) 字段、[store.ts](../server/src/store.ts#L34) 返回值
- 证据：`gateway.ts` 解构 `const { game, player } = store.joinRoom(...)`，忽略 roomId；roomId 可直接从 `game.roomId` 获取。
- 修复：删除 `JoinResult` 的 `roomId` 字段与返回值里的 `roomId`。
- 风险：低。

### B8 文档过时：`protocol.ts` 头部协议注释
- 位置：[protocol.ts](../server/src/protocol.ts#L1-L23)
- 现状：注释称「P0：房间制对战，无棋钟、无断线重连窗口」，且未列 `room.resume`；但 P1 匹配 / P2 重连 / rating.update 均已实现。
- 修复：更新头部清单，补 `room.resume`、`match.queued/found`、`rating.update`、`profile`，措辞改为当前阶段（P0–P3 已完成）。
- 风险：低（纯注释）。

---

## 二、前端（src）

### F1 真实 bug：本地模式「三次重复局面判和」差一次
- 位置：[useGame.js](../src/hooks/useGame.js#L224) `setRepetitions({})`
- 对比：服务端 `Game` 构造函数会把**初始局面**计入 `repetitions`（[room.ts](../server/src/room.ts#L91) `set(boardKey(board,'red'), 1)`）；本地模式未计入。
- 后果：当局面回到**初始局面**时，本地需第 4 次出现才判和，而联机权威规则第 3 次即判和 —— 本地/联机规则不一致。
- 修复：`startNewGame` 中改为

```js
const b = initBoard();
setBoard(b);
...
setRepetitions({ [boardKey(b, 'red')]: 1 });
```
- 风险：低（仅影响回到初始局面的极端情形，且使规则与服务端一致）。

### F2 死代码：`UIManager.applyButtonState` / `buildPieceSelection`
- 位置：[UIManager.js](../src/engine/UIManager.js#L64-L67)、[UIManager.js](../src/engine/UIManager.js#L185-L187)
- 证据：全仓库 grep 无调用。
- 修复：删除两个 static 方法。
- 风险：低。

### F3 死代码：`redViewLabel`（连带 `viewNum`）
- 位置：[MoveIndicatorRenderer.js](../src/engine/MoveIndicatorRenderer.js#L56-L61) `redViewLabel`，及其唯一调用者 `viewNum`（[L50-L53](../src/engine/MoveIndicatorRenderer.js#L50-L53)）
- 证据：grep 无 `redViewLabel` 引用；`viewNum` 仅被 `redViewLabel` 调用。
- 修复：删除两函数；`getGradientColor` / `buildAndRate` 使用的 `scoreToNum` 保留。
- 风险：低。

### F4 死代码：`EngineController.isDeepMode()`
- 位置：[EngineController.js](../src/engine/EngineController.js#L70-L72)
- 证据：grep 无调用。
- 修复：删除该方法。
- 风险：低。

### F5 死代码：`OnlineClient.retryCount` getter
- 位置：[onlineService.js](../src/services/onlineService.js#L37-L39)
- 证据：grep 无调用。
- 修复：删除该 getter。
- 风险：低。

### F6（可选，暂不做）多余 export 与重复实现
- `UIManager.scoreToNum / scoreLabel` 的 `export` 无外部导入 → 可去掉 export，收益极小。
- `scoreToNum` 在 UIManager 与 MoveIndicatorRenderer 各写了一份（两处均相同）→ 建议**保留**，去重会引入 UIManager?MoveIndicatorRenderer 循环依赖，得不偿失。
- 决策：本轮不处理。

---

## 验证（每批改完都跑，最后全量）
1. `cd server && npx tsc --noEmit`（后端类型）
2. `npx oxlint src server/src shared`（Lint，须 0 warn 0 error）
3. `npx vite build`（前端构建）
4. 协议冒烟（复用现有脚本，须全绿）：
   - `node server/scripts/smoke.mjs`（13 项，需 8787 服务端）
   - `node server/scripts/smoke-p1.mjs`（18 项，自拉起隔离实例）
   - `node server/scripts/smoke-p2.mjs`（13 项，需 8787 且 `RECONNECT_GRACE_MS=2000` 以便快速验证 C 场景）
5. 编码：改动若涉及新建含中文文件，落盘后须转 UTF-8 无 BOM 并做字节比对；**覆盖已存在的 UTF-8 中文文件不得再转码**。

## 回归红线
- 协议字段与消息类型**不变**（内部类型 `MoveOutcome.snapshot` / `JoinResult.roomId` 除外，二者均无外部引用）。
- 冒烟三项全绿 + oxlint 干净 + vite build 成功 = 通过。
