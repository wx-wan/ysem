/**
 * Data Layer（数据层）入口 —— Round R-1 Foundation / R-2 Lead / R-3 Customer
 *
 * 职责（唯一）：
 *   find / findMany / findUnique / count / create / update / delete / aggregate / groupBy
 *   以及明确的、可复用的数据查询组合。
 *
 * 不负责：业务状态判断、业务流程、HTTP、用户提示、业务政策、状态机。
 * Repository 可以接收明确的数据查询条件，但**不得**自行决定业务规则。
 *
 * 命名目录（全项目唯一，禁止出现 `repository/` / `data/` / `dao/` 平行目录）。
 */

// ---- 基座 ----
export type { DbClient, TxClient } from './types';
export { runInTransaction } from './transaction';
export type { TransactionOptions } from './transaction';

// ---- Lead Pilot（R-2）----
export { leadRepository } from './lead.repository';
export { channelRepository } from './channel.repository';
export { attachmentRepository } from './attachment.repository';
export { userRepository } from './user.repository';
export { dailyExchangeRateRepository } from './dailyExchangeRate.repository';
export { operationLogRepository } from './operationLog.repository';

// ---- Customer Pilot（R-3）----
export { customerRepository } from './customer.repository';
export { salesOrderRepository } from './salesOrder.repository';
export { opportunityRepository } from './opportunity.repository';
export { sampleOrderRepository } from './sampleOrder.repository';

// ---- Product Layering（R-4）----
export { productRepository } from './product.repository';
export { productTaxonomyRepository } from './productTaxonomy.repository';
export { productGroupRepository, COMBO_ITEM_PRODUCT_SELECT } from './productGroup.repository';
export type { ComboItemInput } from './productGroup.repository';
export { certificateRepository } from './certificate.repository';
