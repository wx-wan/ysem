import { ShipmentStatus } from '@prisma/client';

/**
 * Shipment State Capability —— Round R-5 · Phase 4 · D1-c 出运域
 *
 * **本文件为纯规则**：零 IO、零 Prisma、零 HTTP、零事务。
 * （由 `controllers/shipment.controller.ts` 就地归位而来；原处为混合了 IO 的控制器内部函数，
 *  现将「状态机」与「IO」分离。行为逐字保持一致。）
 *
 * 冻结决策（Round 3C-3-E-1，继续有效）：
 *   · 正常主链   DRAFT → BOOKED → SHIPPED → ARRIVED → COMPLETED
 *   · 异常终止支线 DRAFT / BOOKED / SHIPPED → CANCELLED（含客户自提场景）
 *   · 严格终态   COMPLETED / CANCELLED
 *
 * 语义：
 *   · **DEFAULT DENY** —— 未列出的跨状态转换一律拒绝（409），禁止「看起来合理」的推断；
 *   · 同状态（X → X）为**幂等 no-op**，不视为状态转移（含 COMPLETED / CANCELLED 自身）；
 *   · 终态以「出向集合为空」表达，不额外定义终态常量。
 *
 * 范围（本表仅用于 **update 的状态变更**）：
 *   · create 初始状态策略**不变**（仍为 `body.status ?? ShipmentStatus.DRAFT`）；
 *   · delete **不**加状态门槛（且 D1-c 保持「一律禁止物理删除」）；
 *   · 不触碰数量语义（ShipmentItem.quantity 权威 / shippedQty 重算）、事务、Scope、OperationLog；
 *   · 不引入 QC / Production / SalesOrder 任何 Gate，也不做状态同步。
 *
 * 说明：`SHIPPED → CANCELLED` 仅代表该出运**单据**被业务作废，
 *       已发生的数量、操作日志与相关事实全部保留（不删除、不回滚 shippedQty）。
 */
export const ALLOWED_SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  [ShipmentStatus.DRAFT]: [ShipmentStatus.BOOKED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.BOOKED]: [ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.SHIPPED]: [ShipmentStatus.ARRIVED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.ARRIVED]: [ShipmentStatus.COMPLETED],
  // 终态：出向全部禁止（同状态 no-op 不受影响）
  [ShipmentStatus.COMPLETED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

/** 状态转移 Gate 结果：ok=false 时由调用方统一按 409 处理 */
export type ShipmentStatusGateResult = { ok: true } | { ok: false; message: string };

/**
 * Shipment 状态转移 Gate（纯函数，无 IO —— 便于静态矩阵验证）。
 *
 * 判定顺序：
 *   1) 同状态 → 幂等 no-op（允许，含 COMPLETED / CANCELLED 自身重复提交）
 *   2) 跨状态 → 白名单（DEFAULT DENY，未列出即拒绝）
 */
export function checkShipmentStatusTransition(
  currentStatus: ShipmentStatus,
  requestedStatus: ShipmentStatus,
): ShipmentStatusGateResult {
  // 1) 同状态：幂等 no-op（终态「不可离开」与「同状态重复提交」并不冲突）
  if (currentStatus === requestedStatus) return { ok: true };

  // 2) 跨状态：白名单，未列出即拒绝
  if (!ALLOWED_SHIPMENT_TRANSITIONS[currentStatus].includes(requestedStatus)) {
    return {
      ok: false,
      message: `出运单状态不能从 ${currentStatus} 转换为 ${requestedStatus}`,
    };
  }

  return { ok: true };
}
