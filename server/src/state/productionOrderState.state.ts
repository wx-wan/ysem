import { ProductionStatus } from '@prisma/client';

/**
 * ProductionOrder State Capability —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * **本文件为纯规则**：零 IO、零 Prisma、零 HTTP、零事务。
 * （由 `controllers/productionOrder.controller.ts` 就地归位而来；原处为混合了
 *  IO 的控制器内部函数，现将「状态机」与「IO」分离。行为逐字保持一致。）
 *
 * 冻结决策（Round 3C-3-D-4，继续有效）：
 *   D-FPO3-A = A1  COMPLETED / CANCELLED 为**严格终态**
 *   D-FPO3-B = B1  正常主流程 DRAFT → SCHEDULED → IN_PRODUCTION → QC_PENDING → QC_PASSED → COMPLETED
 *   D-FPO3-C = C1  QC_FAILED 返工回环（QC_PENDING → QC_FAILED → IN_PRODUCTION → QC_PENDING，可多次）
 *   D-FPO3-D = D1  仅 QC_PASSED 可进入 COMPLETED
 *   D-FPO3-E = E1  进入 COMPLETED 前 progress 必须为 100
 *   D-FPO3-H = H4  Scope（能否操作该工单）与 State Gate（该转换是否合法）为两个独立层次
 *
 * 语义：
 *   · **DEFAULT DENY** —— 未列出的跨状态转换一律拒绝（409），禁止「看起来合理」的推断；
 *   · 同状态（X → X）为**幂等 no-op**，不视为状态转移（含 COMPLETED / CANCELLED 自身）；
 *   · 终态以「出向集合为空」表达，不额外定义终态常量。
 *
 * 仅用于 **update 的状态变更**；create 的初始状态策略不变（仍为 `body.status ?? DRAFT`）。
 */
export const ALLOWED_PRODUCTION_TRANSITIONS: Record<ProductionStatus, readonly ProductionStatus[]> = {
  [ProductionStatus.DRAFT]: [ProductionStatus.SCHEDULED, ProductionStatus.CANCELLED],
  [ProductionStatus.SCHEDULED]: [ProductionStatus.IN_PRODUCTION, ProductionStatus.CANCELLED],
  [ProductionStatus.IN_PRODUCTION]: [ProductionStatus.QC_PENDING, ProductionStatus.CANCELLED],
  // 质检门：通过 → QC_PASSED；不通过 → QC_FAILED（返工回环的唯一入口）
  [ProductionStatus.QC_PENDING]: [
    ProductionStatus.QC_PASSED,
    ProductionStatus.QC_FAILED,
    ProductionStatus.CANCELLED,
  ],
  // 返工：**只能**回 IN_PRODUCTION（禁止 QC_FAILED → QC_PASSED / QC_PENDING / DRAFT / SCHEDULED）
  [ProductionStatus.QC_FAILED]: [ProductionStatus.IN_PRODUCTION, ProductionStatus.CANCELLED],
  // 仅 QC_PASSED 可进入 COMPLETED（另需 progress = 100，见 checkProductionStatusTransition）
  [ProductionStatus.QC_PASSED]: [ProductionStatus.COMPLETED, ProductionStatus.CANCELLED],
  // 终态：出向全部禁止（同状态 no-op 不受影响）
  [ProductionStatus.COMPLETED]: [],
  [ProductionStatus.CANCELLED]: [],
};

/**
 * 状态转移白名单判定（同状态恒为 true —— 幂等 no-op，不视为转移）。
 * 内部细节：对外统一经 `checkProductionStatusTransition` 使用。
 */
function isProductionStatusTransitionAllowed(
  from: ProductionStatus,
  to: ProductionStatus,
): boolean {
  if (from === to) return true;
  return ALLOWED_PRODUCTION_TRANSITIONS[from].includes(to);
}

/** 状态转移 Gate 结果：ok=false 时由调用方统一按 409 处理 */
export type ProductionStatusGateResult = { ok: true } | { ok: false; message: string };

/**
 * ProductionOrder 状态转移 Gate（纯函数，无 IO —— 便于静态矩阵验证）。
 *
 * 判定顺序：
 *   1) 同状态 → 幂等 no-op（允许，含 COMPLETED / CANCELLED 自身重复提交）
 *   2) 跨状态 → 白名单（DEFAULT DENY）
 *   3) 目标为 COMPLETED → 另需 `effectiveProgress === 100`（D-FPO3-E = E1）
 */
export function checkProductionStatusTransition(
  currentStatus: ProductionStatus,
  requestedStatus: ProductionStatus,
  effectiveProgress: number,
): ProductionStatusGateResult {
  // 1) 同状态：幂等 no-op（终态「不可离开」与「同状态重复提交」并不冲突）
  if (currentStatus === requestedStatus) return { ok: true };

  // 2) 跨状态：白名单，未列出即拒绝
  if (!isProductionStatusTransitionAllowed(currentStatus, requestedStatus)) {
    return {
      ok: false,
      message: `生产工单状态不能从 ${currentStatus} 转换为 ${requestedStatus}`,
    };
  }

  // 3) 进入 COMPLETED 的 progress 前置（仅 QC_PASSED → COMPLETED 能到达此处）
  if (requestedStatus === ProductionStatus.COMPLETED && effectiveProgress !== 100) {
    return {
      ok: false,
      message: `生产工单完成前，progress 必须为 100（当前 ${effectiveProgress}）`,
    };
  }

  return { ok: true };
}
