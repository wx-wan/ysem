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
export { customerRepository } from './customer.repository';
// 以下三个原本为「业务域只读读模型」；Round R-5 · Phase 1 已按 D15 约定**就地扩展**为
// 对应销售域（Opportunity / SampleOrder / SalesOrder）的权威访问仓储，**未**新建平行仓储。
export { salesOrderRepository } from './salesOrder.repository';
export { opportunityRepository } from './opportunity.repository';
export { sampleOrderRepository } from './sampleOrder.repository';

// ---- Sales Process Domain（R-5 · Phase 1）----
export { quotationRepository } from './quotation.repository';

// ---- Approval Domain（R-5 · Phase 4 · D3）----
export { approvalConfigRepository } from './approvalConfig.repository';
export { approvalRecordRepository } from './approvalRecord.repository';
// 下列为「多态审批引用」读取所需的最小面，由 D1 / D2 履约与财务域迁移时**就地扩展**
export { productionOrderRepository } from './productionOrder.repository';
export { shipmentRepository } from './shipment.repository';
export { purchaseOrderRepository } from './purchaseOrder.repository';
export { paymentRepository } from './payment.repository';
export { profitRepository } from './profit.repository';

// ---- Master Data Domain（R-5 · Phase 2）----
export { dictionaryRepository } from './dictionary.repository';
export type { DictionaryTable } from './dictionary.repository';
export { exchangeRepository } from './exchange.repository';

// ---- Product Layering（R-4）----
export { productRepository } from './product.repository';
export { productTaxonomyRepository } from './productTaxonomy.repository';
export { productGroupRepository, COMBO_ITEM_PRODUCT_SELECT } from './productGroup.repository';
export type { ComboItemInput } from './productGroup.repository';
export { certificateRepository } from './certificate.repository';
