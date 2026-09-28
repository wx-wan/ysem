/**
 * Business Layer（业务层）入口 —— Round R-1 Foundation / R-2 Lead Pilot 首批落地
 *
 * 职责：
 *   - 业务规则
 *   - 状态转换（状态机权威在服务端）
 *   - 跨实体业务流程（如「线索确认 → 客户 → 商机」）
 *   - 业务前置条件
 *   - 业务权限规则中的「业务部分」
 *   - 业务事务编排
 *   - 领域级数据组合
 *
 * 不负责：
 *   - 读取 req/res、返回 HTTP Response、处理 HTTP status code
 *   - 直接依赖 Express / Fastify 的 Controller 对象
 *
 * 调用方向：Business 层**可以**调用 Operation 层与 Data 层；
 * 但 Operation / Data 层**不得**反向依赖 Business 层。
 *
 * 命名目录（全项目唯一，禁止出现 `service/` / `business/` 平行目录）。
 */

// 领域错误契约住在共享层 lib/errors.ts（原因见该文件头注释：它同时被 HTTP 边界与
// 领域层使用，若落在 services/ 会造成 middleware → services 的反向依赖）。
// 此处再导出，仅为 Business 层提供统一的层内入口；单一事实来源仍在 lib/errors.ts。
export {
  DomainError,
  DomainValidationError,
  DomainNotFoundError,
  DomainForbiddenError,
  DomainConflictError,
} from '../lib/errors';
export type { DomainErrorOptions } from '../lib/errors';

// ---- Lead Pilot（R-2）----
export * as leadService from './lead.service';

// ---- Customer Pilot（R-3）----
export * as customerService from './customer.service';
export type {
  CustomerActorContext,
  CustomerScopeProvider,
  CustomerListInput,
  CreateCustomerInput,
  UpdateCustomerInput,
} from './customer.service';

// ---- Product Layering（R-4）----
export * as productService from './product.service';
export * as productGroupService from './productGroup.service';
export * as productTaxonomyService from './productTaxonomy.service';
export type {
  ProductActorContext,
  ProductWriteInput,
  ProductListFilters,
  ProductMixedFilters,
} from './product.service';
export type { ProductGroupActorContext, GroupInput, GroupItemsInput } from './productGroup.service';

// ---- Sales Process Domain（R-5 · Phase 1）----
export * as opportunityService from './opportunity.service';
export * as quotationService from './quotation.service';
export * as sampleOrderService from './sampleOrder.service';
export * as salesOrderService from './salesOrder.service';
export * as channelService from './channel.service';
export type { SalesActorContext } from './salesProcess.shared';

// ---- Approval Domain（R-5 · Phase 4 · D3）----
export * as approvalConfigService from './approvalConfig.service';
export * as approvalRecordService from './approvalRecord.service';
export type { ApprovalActorContext } from './approvalRecord.service';

// ---- Master Data Domain（R-5 · Phase 2）----
// 字典域按**域**收敛（币种 / 单位 / 客户类型 / 沟通工具 共享同一套规则实现）；
// 认证资质与汇率为各自独立主数据服务。
export * as dictionaryService from './dictionary.service';
export * as certificateService from './certificate.service';
export * as exchangeService from './exchange.service';
export type { DictionaryKind, DictionarySortItem } from './dictionary.service';
