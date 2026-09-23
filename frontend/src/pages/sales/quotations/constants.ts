import type { QuotationStatus } from '../../../types/quotation';

/**
 * 报价（Quotation）UI 常量（Round F-S3）
 *
 * 原则：**值**逐字来自后端真实契约（prisma enum），前端只补中文 label 与分页边界；
 * 币种选项**复用** F-S1 已收口的 `CURRENCY_OPTIONS`（值 = 后端 Currency 白名单），不新造枚举。
 */

/** 状态中文 label（键 = prisma `enum QuotationStatus`，逐字一致） */
export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '已提交',
  SENT: '已发送',
  ACCEPTED: '已接受',
  REJECTED: '已拒绝',
  EXPIRED: '已过期',
};

export const QUOTATION_STATUS_COLOR: Record<QuotationStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'orange',
};

/** 状态选项（仅用于**筛选**与展示；F-S3 不提供状态变更 UI —— 后端无流转规则） */
export const QUOTATION_STATUS_OPTIONS: { label: string; value: QuotationStatus }[] = (
  Object.keys(QUOTATION_STATUS_LABEL) as QuotationStatus[]
).map((status) => ({ label: QUOTATION_STATUS_LABEL[status], value: status }));

/** 列表筛选：状态（含「全部」= 不发送 status 参数） */
export const QUOTATION_STATUS_FILTER_OPTIONS: { label: string; value: QuotationStatus | 'ALL' }[] = [
  { label: '全部状态', value: 'ALL' },
  ...QUOTATION_STATUS_OPTIONS,
];

/**
 * 币种选项 —— **复用** F-S1 收口的选项（值 = 后端 Currency 枚举白名单：CNY/USD/EUR/GBP/JPY/HKD/
 * AUD/CAD/KRW/RUB/SEK/NOK/DKK）。后端 `resolveExchangeRate` 语义：CNY 恒为 1，其余币种入参优先、
 * 其次 DailyExchangeRate 最近一期、取不到则为 null（不按 1 兜底、不伪造）。
 */
export { CURRENCY_OPTIONS as QUOTATION_CURRENCY_OPTIONS } from '../../products/constants';

/** 分页（后端 pageSize 上限 100；前端不发送越界值） */
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [20, 50, 100];

/** 单位固定值（后端 QuotationItem.unit 默认 'PCS'；F-S3 表单不提供单位输入） */
export const QUOTATION_DEFAULT_UNIT = 'PCS';

/** 状态只读提示（后端允许直接写 status 但**无任何流转规则** ⇒ F-S3 不设计状态机） */
export const STATUS_READONLY_HINT = '报价状态当前无流转规则，本阶段仅展示，不提供状态变更入口。';

/** 编辑明细重建提示（后端 update 传 items 时先 deleteMany 再 create） */
export const ITEMS_REBUILD_HINT = '保存时将按下方明细整体覆盖该报价的产品明细。';

/**
 * 单价必填提示（后端 parseItems：`unitPrice ?? 0` 为 0 即判非法 ⇒ `unitPrice > 0` 是硬约束；
 * 商机明细的 targetPrice 为「客户目标价」语义，**不**作为报价单价带入）
 */
export const UNIT_PRICE_REQUIRED_HINT = '报价单价需逐行填写（> 0）；系统不会用产品标准价或商机目标价自动填充。';

/** 创建时「商机无关联产品明细」提示 */
export const NO_SOURCE_ITEMS_HINT = '该商机没有可带入的产品明细，请手动添加产品行。';

/** 创建时「商机明细未关联产品」提示（productId 为空的明细无法带入报价） */
export const DETACHED_SOURCE_ITEMS_HINT =
  '该商机存在未关联产品的明细，无法带入报价；请在报价中手动添加对应产品行。';

/** 编辑时「关联产品不可用」提示（后端对不可见 productId 直接 400） */
export const UNAVAILABLE_ITEM_PRODUCT_HINT =
  '该明细关联的产品当前不可用。保存前请替换或移除该产品。';

/** 明细展示兜底：关联产品不可用时的名称来源（快照 productName） */
export const ITEM_PRODUCT_UNAVAILABLE_LABEL = '历史产品';

/** 列表无关键词搜索的说明（后端 /api/quotations 无 keyword 参数） */
export const LIST_FILTER_NOTE = '报价列表支持按状态与商机筛选；后端未提供关键词搜索。';

/** 金额展示提示（Decimal → string，前端不做数值重算） */
export const AMOUNT_SOURCE_HINT = '金额均取自后端返回值（本币折算在无可用汇率时为空，不按 1 估算）。';
