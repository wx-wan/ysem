import type { Currency } from './customer';

/**
 * Quotation（报价）类型（Round F-S3 · Quotation MVP）
 *
 * 字段**只**来自后端真实返回（只读核对，未臆造）：
 *   · server/prisma/schema/06-quotation.prisma  `model Quotation` / `model QuotationItem`
 *   · server/src/controllers/quotation.controller.ts
 *       - QUOTATION_INCLUDE      L62-69 → customer{id,customerNo,companyName} · opportunity{id,opportunityNo,title}
 *                                        · items[+product{id,name,sku}]（sort asc）
 *       - listQuotations         L251-286 → data { list, total, page, pageSize }
 *       - getQuotation           L289-304 → 同上 include；**无 owner 投影、无 activities**；404「报价不存在」
 *       - createQuotation        L307-422 → createSchema L105-121（白名单）
 *       - updateQuotation        L425-542 → `createSchema.partial() + id`；传 items ⇒ 整表重建
 *   · server/src/utils/scope.ts projectProductRow → 关联产品不可见时 `product = null` **且 `productName = null`**
 *   · server/prisma/schema/00-enums.prisma `enum QuotationStatus { DRAFT SUBMITTED SENT ACCEPTED REJECTED EXPIRED }`
 *
 * 类型规则（沿用 F-5）：
 *   · **Decimal 字段一律 string**：quantity · unitPrice · amount · totalAmount · totalAmountCny · exchangeRate
 *     · costPrice —— 不得在类型层声明为 number，也不得在展示层做数值重算；
 *   · DateTime → ISO string；
 *   · `Currency` 复用 types/customer.ts 的既有联合类型（全站单一来源）。
 */

export type { Currency };

/** 报价状态（prisma enum QuotationStatus，**只读展示**；后端无流转校验） */
export type QuotationStatus = 'DRAFT' | 'SUBMITTED' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

/** 明细关联产品的公开投影（DQ-3=C 白名单：id / name / sku） */
export interface QuotationItemProduct {
  id: string;
  name: string;
  sku: string | null;
}

/**
 * 报价明细（QuotationItem）
 *
 * · `productId` / `product` 均可为 null（产品已删除 → SetNull；产品不可见 → 读取侧投影为 null）；
 * · `productName` 为**快照**字段：模型层非空，但产品**不可见**时读取侧会把它置为 null
 *   （产品**已删除**时投影不生效 ⇒ 快照名仍可显示）⇒ 类型必须允许 null；
 * · quantity / unitPrice / amount / costPrice 均为 Decimal → string。
 */
export interface QuotationItem {
  id: string;
  quotationId: string;
  productId: string | null;
  product: QuotationItemProduct | null;
  productName: string | null;
  productSku: string | null;
  spec: string | null;
  craft: string | null;
  size: string | null;
  packaging: string | null;
  /** Decimal → string */
  quantity: string;
  /** 单位（后端默认 'PCS'） */
  unit: string;
  /** Decimal → string */
  unitPrice: string;
  /** Decimal → string（后端写入时为 quantity × unitPrice，除非显式传入） */
  amount: string;
  currency: Currency;
  /** Decimal → string */
  costPrice: string | null;
  leadTime: number | null;
  remark: string | null;
  sort: number;
  /** ISO string */
  createdAt: string;
  /** ISO string */
  updatedAt: string;
}

/** 客户精简投影（QUOTATION_INCLUDE.customer） */
export interface QuotationCustomerLite {
  id: string;
  customerNo: string;
  companyName: string;
}

/** 商机精简投影（QUOTATION_INCLUDE.opportunity） */
export interface QuotationOpportunityLite {
  id: string;
  opportunityNo: string;
  title: string;
}

/** 报价标量行（Prisma Quotation 全字段） */
export interface QuotationBase {
  id: string;
  /** QU-yyyyMMdd-0001（后端 NumberSequence 生成） */
  quotationNo: string;
  opportunityId: string;
  customerId: string;
  /** 同一商机内自增（后端 `max(version)+1`，`@@unique([opportunityId, version])`） */
  version: number;
  /** 版本链上一版 id（后端当前 Deferred，**始终为 null**） */
  parentId: string | null;
  title: string;
  currency: Currency;
  /** Decimal → string（缺失汇率时为 null，后端不按 1 兜底） */
  exchangeRate: string | null;
  /** Decimal → string（NOT NULL） */
  totalAmount: string;
  /** Decimal → string（无可用汇率时为 null） */
  totalAmountCny: string | null;
  tradeTerms: string | null;
  paymentTerms: string | null;
  leadTime: number | null;
  /** ISO string */
  validUntil: string | null;
  portOfLoading: string | null;
  status: QuotationStatus;
  /** ISO string（写入 status 为对应值时的联动时间戳） */
  submittedAt: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  /** 客户快照（ADR-04；后端当前 Deferred，**始终为 null**） */
  customerSnapshot: Record<string, unknown> | null;
  notes: string | null;
  /** ⚠ QUOTATION_INCLUDE **不含 owner 投影** ⇒ 列表/详情拿不到负责人姓名（仅 ownerId） */
  ownerId: string | null;
  createdBy: string | null;
  /** ISO string */
  createdAt: string;
  updatedBy: string | null;
  /** ISO string */
  updatedAt: string;
}

/** 列表行 / 详情（两者 include 结构相同：customer + opportunity + items） */
export interface QuotationListItem extends QuotationBase {
  customer: QuotationCustomerLite;
  opportunity: QuotationOpportunityLite;
  items: QuotationItem[];
}

export type QuotationDetail = QuotationListItem;

/**
 * 列表查询参数（GET /api/quotations）
 *
 * 后端真实支持：opportunityId · customerId · status · productId · page · pageSize（上限 100）。
 * ★ **无 keyword / 无文本搜索**（后端不支持）⇒ 前端不得伪造搜索能力。
 */
export interface QuotationListQuery {
  opportunityId?: string;
  customerId?: string;
  status?: QuotationStatus;
  productId?: string;
  page?: number;
  pageSize?: number;
}

/**
 * 报价明细入参（**严格等于** itemSchema 白名单中 F-S3 实际提交的键）
 *
 * F-S3 提交策略（见 Decision Freeze D-FS3-006）：productId 必填 · quantity ≥ 1 · unitPrice > 0。
 * 后端 parseItems 语义：
 *   · productId 指定但产品不存在 / 不可见 ⇒ 400（不可见与不存在同文案，无 existence oracle）
 *   · productName / productSku / packaging 未传时由后端取 Product 当前值做快照
 *   · amount 未传时后端 = quantity × unitPrice（Decimal 运算）
 */
export interface QuotationItemInput {
  productId: string;
  productName?: string;
  productSku?: string | null;
  quantity: number;
  /** 单位（F-S3 固定提交 'PCS'，与后端默认一致） */
  unit?: string;
  unitPrice: number;
}

/**
 * 创建载荷（**严格等于** createSchema 白名单中 F-S3 使用的键）
 *
 * 明确**不提交**（后端自行推导/兜底，避免双源）：
 *   · customerId     → `body.customerId ?? opportunity.customerId`（后端 L322）
 *   · totalAmount    → 由明细汇总（后端 L336；前端不做金额计算）
 *   · exchangeRate   → 后端按 rateToCny 解析（入参优先 / DailyExchangeRate 兜底 / 取不到为 null）
 *   · status         → 后端默认 DRAFT（F-S3 状态只读，不做流转）
 *   · ownerId        → 不在 F-S3 UI 范围（F-01 owner 候选源缺失）
 */
export interface QuotationCreatePayload {
  opportunityId: string;
  title: string;
  currency?: Currency;
  /** 'YYYY-MM-DD'（后端 new Date(...)） */
  validUntil?: string | null;
  notes?: string | null;
  items?: QuotationItemInput[];
}

/**
 * 更新载荷（后端 `createSchema.partial() + id`）
 *
 * F-S3 编辑**不提交** opportunityId / customerId / status / ownerId / version / parentId；
 * 传 `items` ⇒ 后端整表重建明细（故仅在明细实际变化时才提交，见 D-FS3-009）。
 */
export interface QuotationUpdatePayload {
  title?: string;
  currency?: Currency;
  validUntil?: string | null;
  notes?: string | null;
  items?: QuotationItemInput[];
}
