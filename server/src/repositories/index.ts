/**
 * Data Layer（数据层）入口 —— Round R-1 Foundation / R-2 Lead / R-3 Customer / R-4 Product
 *
 * 职责（唯一）：
 *   find / findMany / findUnique / count / create / update / delete / aggregate / groupBy
 *   以及明确的、可复用的数据查询组合。
 *
 * 不负责：业务状态判断、业务流程、HTTP、用户提示、业务政策、状态机。
 * Repository 可以接收明确的数据查询条件，但**不得**自行决定业务规则。
 *
 * 命名目录（全项目唯一，禁止出现 `repository/` / `data/` / `dao/` 平行目录）。
 *
 * 【仓储的两种角色（Round R-5.2 · D15 澄清）】
 *   ① **数据对象的权威访问**：该表 / 聚合的唯一归属仓储（如 `customerRepository` / `productRepository`）。
 *   ② **业务域的只读读模型**：为**其他**模块的读需求提供只读聚合能力，
 *      本身不承载该业务域的 CRUD 或状态机 ——
 *      `opportunityRepository` / `salesOrderRepository` / `sampleOrderRepository`
 *      当前均属此类（R-3 为 Customer 列表 / 报表 / 意向派生建立）。
 *      后续这些业务域进入分层时，应**扩展**对应仓储，**不得**新建平行仓储。
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
// 后三个为「业务域只读读模型」（非 Customer 自身）：仅供 Customer 列表 / 报表 / 意向派生使用
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
