import type { Currency, IntentLevel } from './customer';

/**
 * 复用 shared 枚举联合类型（来源 = types/customer.ts，全站单一来源，不重复定义）
 * 再导出便于 sales 域消费者直接从本模块引用。
 */
export type { Currency, IntentLevel };

/**
 * Opportunity（商机）类型（Round F-S2 · Opportunity MVP UI）
 *
 * 字段**只**来自后端真实返回（只读核对，未臆造）：
 *   · server/prisma/schema/05-opportunity.prisma  `model Opportunity` / `model OpportunityItem` / `model OpportunityActivity`
 *   · server/src/controllers/sales.controller.ts
 *       - OPPORTUNITY_INCLUDE  L81-89 → owner{id,realName,username} · customer{id,companyName,contactName}
 *                                       · lead{id,leadNo,leadName} · items[+ product{id,name,sku}]（sort asc）
 *       - getOpportunities     L133-220 → data { list, total, page, pageSize }；行 = 全字段 + include + `stage`（派生）
 *       - getOpportunity       L269-289 → 同上 + activities（take 30, createdAt desc）+ `stage`
 *       - createOpportunity    L345-427 → createOpportunitySchema 白名单（L30-52）
 *       - updateOpportunity    L431-529 → `createOpportunitySchema.partial()`；传 `products` 则**重建** items
 *   · server/src/utils/scope.ts projectProductRow L202-219（读取侧可见性投影）：
 *       关联产品不可见 ⇒ `product = null`，且当 `productId != null` 时 **`productName` 一并置 null**
 *   · server/src/utils/pipelineStage.ts L16 / L72-75：`stage` 为**派生值**（不落库），取值
 *       'LEAD' | 'OPPORTUNITY' | 'QUOTED' | 'SAMPLE' | 'PRODUCTION' | 'SHIPPED' | 'ORDER'
 *
 * 类型规则（沿用 F-5）：
 *   · Decimal（estimatedAmount / probability / targetPrice / exchangeRate）→ JSON **string**，不在 API 层做 Number() 转换；
 *   · DateTime → ISO string；
 *   · `Currency` / `IntentLevel` 为全站共享的 prisma 枚举联合类型，**复用** types/customer.ts 的既有声明
 *     （不重复定义，避免两份标签/取值漂移）。
 */

/**
 * 商机阶段（**派生字段**，不落库、不可人工切换）
 *
 * 由后端 utils/pipelineStage.ts 依据关联单据推导（Quotation / SampleOrder / SalesOrder…）。
 */
export type PipelineStage = 'LEAD' | 'OPPORTUNITY' | 'QUOTED' | 'SAMPLE' | 'PRODUCTION' | 'SHIPPED' | 'ORDER';

/** 商机结论（prisma enum OpportunityOutcome，唯一落库的终态字段） */
export type OpportunityOutcome = 'OPEN' | 'WON' | 'LOST';

/** 商机负责人投影（OPPORTUNITY_INCLUDE.owner） */
export interface OpportunityOwnerLite {
  id: string;
  realName: string;
  username: string;
}

/** 商机客户投影（OPPORTUNITY_INCLUDE.customer） */
export interface OpportunityCustomerLite {
  id: string;
  companyName: string;
  contactName: string | null;
}

/** 商机来源线索投影（OPPORTUNITY_INCLUDE.lead；本阶段不消费，仅为契约完整） */
export interface OpportunityLeadLite {
  id: string;
  leadNo: string;
  leadName: string;
}

/** 明细关联产品的公开投影（DQ-3=C 白名单：id / name / sku） */
export interface OpportunityItemProduct {
  id: string;
  name: string;
  sku: string | null;
}

/**
 * 商机明细（OpportunityItem）
 *
 * · `productName` 为**快照**字段；模型层非空，但读取侧投影在「关联产品不可见」时会把它置为 `null`
 *   （utils/scope.ts projectProductRow L213）⇒ 类型必须允许 null。
 * · `product` 同理：不可见 ⇒ `null`。
 */
export interface OpportunityItem {
  id: string;
  opportunityId: string;
  productId: string | null;
  product: OpportunityItemProduct | null;
  productName: string | null;
  spec: string | null;
  quantity: number;
  /** Decimal → string */
  targetPrice: string | null;
  currency: Currency;
  remark: string | null;
  sort: number;
  /** ISO string */
  createdAt: string;
  /** ISO string */
  updatedAt: string;
}

/** 商机标量行（Prisma Opportunity 全字段） */
export interface OpportunityBase {
  id: string;
  /** BO-yyyyMMdd-0001（后端 NumberSequence 生成） */
  opportunityNo: string;
  title: string;
  customerId: string;
  leadId: string | null;
  outcome: OpportunityOutcome;
  /** ISO string */
  outcomeAt: string | null;
  /** ISO string */
  wonAt: string | null;
  lostReason: string | null;
  /** Decimal → string */
  estimatedAmount: string | null;
  currency: Currency;
  /** Decimal → string（汇率快照） */
  exchangeRate: string | null;
  /** ISO string */
  estimatedCloseDate: string | null;
  intentLevel: IntentLevel | null;
  /** Decimal → string（50.00 = 50%） */
  probability: string | null;
  notes: string | null;
  ownerId: string | null;
  createdBy: string | null;
  /** ISO string */
  createdAt: string;
  updatedBy: string | null;
  /** ISO string */
  updatedAt: string;
}

/** 列表行（GET /api/sales 的 data.list 元素 = 标量行 + include + 派生 stage） */
export interface OpportunityListItem extends OpportunityBase {
  owner: OpportunityOwnerLite | null;
  customer: OpportunityCustomerLite;
  lead: OpportunityLeadLite | null;
  items: OpportunityItem[];
  /** 派生阶段（后端 utils/pipelineStage.ts） */
  stage: PipelineStage;
}

/** 商机活动（OpportunityActivity；详情返回最近 30 条，createdAt desc） */
export interface OpportunityActivity {
  id: string;
  opportunityId: string | null;
  leadId: string | null;
  /** CREATED / STAGE_CHANGE / NOTE_ADDED / QUOTATION_SENT / WON / LOST */
  action: string;
  fromStage: string | null;
  toStage: string | null;
  comment: string | null;
  createdBy: string;
  /** ISO string */
  createdAt: string;
}

/** 详情（GET /api/sales/:id 的 data = 列表行 + activities + stage） */
export interface OpportunityDetail extends OpportunityListItem {
  activities: OpportunityActivity[];
}

/**
 * 列表查询参数（GET /api/sales）
 *
 * 后端真实支持：page · pageSize · keyword（title/customer.companyName contains）· stage（**派生阶段**，
 * 走「先全量派生再分页」路径）· ownerId（**仅 admin**）· startDate / endDate（createdAt 区间）。
 * 本阶段只使用 page / pageSize / keyword（其余不在 MVP 范围）。
 */
export interface OpportunityListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  stage?: PipelineStage;
  ownerId?: string;
  startDate?: string;
  endDate?: string;
}

/** 商机关联产品入参（productId 为真实 Product.id；quantity 为正整数，省略时后端取 1） */
export interface OpportunityProductInput {
  productId: string;
  quantity?: number;
}

/**
 * 创建载荷（**严格等于** createOpportunitySchema 白名单）
 *
 * 注意：
 *   · `probability` 为**旧版兼容字段**（字符串；中文文案会映射为 intentLevel，数字串映射为 probability 数值），
 *     本阶段**不暴露**该字段（避免双语义）；
 *   · `ownerId` 亦不暴露（F-01 owner 候选源缺失 ⇒ owner 指派 BLOCKED，与 Customer 表单一致）；
 *   · 阶段（stage）不在此处：由后端按关联单据派生，不接受人工传入。
 */
export interface OpportunityCreatePayload {
  customerId: string;
  title: string;
  estimatedAmount?: number | null;
  /** 'YYYY-MM-DD'（后端 new Date(...)） */
  estimatedCloseDate?: string | null;
  intentLevel?: IntentLevel | null;
  notes?: string | null;
  leadId?: string | null;
  ownerId?: string | null;
  products?: OpportunityProductInput[];
}

/**
 * 更新载荷（后端 `createOpportunitySchema.partial()`）
 *
 * 语义要点（后端 L463-490）：
 *   · 传 `products` ⇒ **重建** items（先 deleteMany 再 create）；不传 ⇒ 明细保持不变；
 *   · `intentLevel` 传 `null` **不能清空**（null ?? undefined ⇒ 无操作）⇒ 本阶段 UI 不提供「清空意向」；
 *   · `customerId` 后端可改，但本阶段 UI **不提供**「更换客户」（保 MVP 与派生口径稳定）。
 */
export type OpportunityUpdatePayload = Partial<OpportunityCreatePayload>;
