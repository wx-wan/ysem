import type { SalesActorContext } from './salesProcess.shared';

/**
 * 财务域（Finance Domain）共享业务上下文 —— Round R-5 · Phase 4 · D2
 *
 * 存在的理由：Payment / Profit **自身都没有 ownerId**，数据范围一律经宿主继承：
 *   · Payment → `salesOrder.ownerId` 或 `purchaseOrder.ownerId`（双宿主 OR）
 *   · Profit  → `salesOrder.ownerId`
 * 这些「关系型 scope 提供者」与销售域的单表 `owner()` 不同，因此在销售域上下文之上**扩展**，
 * 而不是把财务专属的关系路径塞进 `SalesActorContext`（避免销售域被迫理解财务宿主模型）。
 *
 * 边界：本文件只声明上下文形状，不含业务规则、不含 IO。
 */

export interface FinanceActorContext extends SalesActorContext {
  scope: SalesActorContext['scope'] & {
    /** roleScope(req, { field: 'ownerId', relation: 'salesOrder' }) */
    salesOrderOwner(): Promise<Record<string, unknown>>;
    /** roleScope(req, { field: 'ownerId', relation: 'purchaseOrder' }) */
    purchaseOrderOwner(): Promise<Record<string, unknown>>;
  };
}
