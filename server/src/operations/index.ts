/**
 * Operation Layer（操作层）入口 —— Round R-1 Foundation / R-2 Lead Pilot 首批落地
 *
 * 职责：
 *   - 多个 Data Layer 操作的组合
 *   - 可复用的数据操作流程
 *   - 查询组合
 *   - 事务中的数据库操作编排
 *   - 跨 Repository 数据访问
 *
 * 不负责：决定业务政策。
 *
 * 【边界示例】（来自架构冻结文档，用于区分本层与 Business 层）
 *   `createCustomerFromLead()` 若只做「读取 Lead → 读取 Customer 相关数据 →
 *   创建 Customer → 更新 Lead」，属** Operation 层**；
 *   而「什么时候允许 Confirm」「Confirm 是否允许创建 Customer」
 *   「Customer.channelId 应该如何确定」属 **Business 层**。
 *
 * 命名目录（全项目唯一，禁止出现 `operation/` 平行目录）。
 */

/**
 * Operation 层统一的调用上下文。
 *
 * 存在的理由：Operation 函数需要（a）一个可能处于事务中的数据库客户端，
 * （b）写入 OperationLog 时所需的操作人身份。两者若由每个 Operation 自行拼装，
 * 首个试点模块就会发明出自己的约定 —— 因此在此处冻结最小约定。
 */
export interface OperationContext {
  /** 事务客户端或全局单例；由调用方决定是否处于事务中 */
  db: import('../repositories/types').DbClient;
  /** 操作人身份（来自 JWT 解析结果，Controller 注入） */
  actor: {
    userId: string;
    username: string;
    realName?: string;
  };
}

// ---- Lead Pilot（R-2）----
export * from './lead.operations';

// ---- Customer Pilot（R-3）----
export * from './customer.operations';

// ---- Product Layering（R-4）----
export * from './product.operations';
export * from './productGroup.operations';

// ---- Sales Process Domain（R-5 · Phase 1）----
// 销售域**唯一**事务归属地：Opportunity / Quotation / SampleOrder / SalesOrder
// 的编号分配、跨表编排、Customer 订单统计回算均在此文件内完成。
export * from './sales.operations';

// ---- Procurement Domain（R-5 · Phase 4 · D1-a）----
// 采购域 $transaction 唯一归属地：Supplier 取号、PurchaseOrder 建/改（含生产明细行锁）。
export * from './procurement.operations';

// ---- Finance Domain（R-5 · Phase 4 · D2）----
// 跨域回写与事务编排：Payment → SalesOrder.paidAmountCny 重算；Profit → Shipment 运费归集。
export * from './finance.operations';

// ---- Approval Domain（R-5 · Phase 4 · D3）----
// 多态业务引用分派 + 审批流转事务（审批域 $transaction 的唯一归属地）。
export * from './approval.operations';

// ---- State Capability（R-5 · Phase 3）----
// State 相关数据操作流程：线索状态推进、商机阶段派生的信号装载与组合。
// State 规则本身是纯函数，位于 src/state/（不访问 Prisma / HTTP）。
export * from './state.operations';

// ---- Master Data Domain（R-5 · Phase 2）----
// 字典域唯一需要事务的操作：批量更新排序。
export * from './dictionary.operations';
