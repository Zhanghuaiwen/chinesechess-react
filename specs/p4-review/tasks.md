# P4 任务清单

对应 spec：[spec.md](./spec.md)

## 批次 1：后端清理与修 bug（server/src）
- [ ] T1 B1 修 bug：[gateway.ts](../server/src/gateway.ts#L45) 对 `msg.name` 做 `typeof === 'string'` 归一化后再传 `store.joinRoom`
- [ ] T2 B2 删死代码：删除 [gateway.ts](../server/src/gateway.ts#L256) `export type { ServerMessage };`，import 收敛为 `ClientMessage`
- [ ] T3 B3 删死代码：删除 [room.ts](../server/src/room.ts#L307-L309) `Game.start()`
- [ ] T4 B4 删冗余：删除 [room.ts](../server/src/room.ts#L47-L52) `MoveOutcome.snapshot` 字段与 [L295](../server/src/room.ts#L295) 赋值
- [ ] T5 B5 删冗余：删除 [matchmaker.ts](../server/src/matchmaker.ts#L40-L45) `stop()`
- [ ] T6 B6 删冗余：删除 [ratings.ts](../server/src/ratings.ts#L117-L119) `size` getter
- [ ] T7 B7 删冗余：删除 [store.ts](../server/src/store.ts#L9) `roomId` 字段与 [L34](../server/src/store.ts#L34) 返回值
- [ ] T8 B8 更新注释：[protocol.ts](../server/src/protocol.ts#L1-L23) 头部消息清单与阶段说明
- [ ] V1 后端验证：`cd server && npx tsc --noEmit`；`npx oxlint src server/src shared`

## 批次 2：前端去冗余与修 bug（src）
- [ ] T9 F1 修 bug：[useGame.js](../src/hooks/useGame.js#L224) 初始局面计入 `repetitions`
- [ ] T10 F2 删死代码：[UIManager.js](../src/engine/UIManager.js) 删 `applyButtonState` + `buildPieceSelection`
- [ ] T11 F3 删死代码：[MoveIndicatorRenderer.js](../src/engine/MoveIndicatorRenderer.js) 删 `redViewLabel` + `viewNum`
- [ ] T12 F4 删死代码：[EngineController.js](../src/engine/EngineController.js#L70-L72) 删 `isDeepMode()`
- [ ] T13 F5 删死代码：[onlineService.js](../src/services/onlineService.js#L37-L39) 删 `retryCount`
- [ ] V2 前端验证：`npx vite build`；`npx oxlint src`

## 批次 3：全量回归
- [ ] T14 重启服务端（8787，`RECONNECT_GRACE_MS=2000` 跑 P2）
- [ ] T15 `node server/scripts/smoke.mjs`（13 项全绿）
- [ ] T16 `node server/scripts/smoke-p1.mjs`（18 项全绿）
- [ ] T17 `node server/scripts/smoke-p2.mjs`（13 项全绿）
- [ ] T18 编码自检：改动文件 UTF-8 字节比对（含中文文件）+ `node --check`
- [ ] T19 汇总：列出删除的冗余/修复的 bug/验证结果
