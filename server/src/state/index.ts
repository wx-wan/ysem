/**
 * State Capability（状态能力）入口 —— Round R-5 · Phase 3
 *
 * 【能力定位】State 是**跨销售过程的统一横向能力**，不是「每个模块各有一个 State」。
 *
 * 【硬边界（冻结，且由 `scripts/check-layering.ts` 强制）】
 *   - 不访问 Prisma（不得 import `lib/prisma`）
 *   - 不访问 HTTP（不得 import express 系列）
 *   - 不依赖业务层（不得 import controllers / services / operations / repositories）
 *   - 不承担跨域编排、不执行数据库事务
 *
 * 因此本目录内只允许：纯函数、纯常量、纯类型。
 * 持久化与编排在 `operations/state.operations.ts`。
 */

export * from './leadStatus.state';
export * from './pipelineStage.state';
export * from './customerIntent.state';

// ---- ProductionOrder State（R-5 · Phase 4 · D1-b）----
export * from './productionOrderState.state';
