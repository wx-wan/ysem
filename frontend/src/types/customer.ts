/**
 * Customer 类型（Round F-5）
 *
 * 字段来源 = **prisma schema + customer.controller 实际 select/include**，逐项核对，未凭页面猜测。
 *
 * 序列化规则（F-0）：
 *   · Prisma `Decimal` → JSON **string**（decimal.js 的 toJSON），故 totalAmount / totalAmountCny /
 *     paidAmountCny / quantity / unitPrice / amount / estimatedAmount(`_sum`) 等均为 string；
 *   · `DateTime` → ISO **string**（前端不在 API 层转 Date，格式化留给 presentation layer）；
 *   · `String[]`（tags / colors）→ string[]。
 *
 * 区分三类形状，避免把 list / detail 当同一结构：
 *   · CustomerListItem        —— /public 列表项（无 pipelineAmount）
 *   · CustomerPipelineListItem —— /my、/all 列表项（含 pipelineAmount）
 *   · CustomerDetail          —— /:id 详情（含 salesOrders 投影 / opportunities / activities）
 */

import type { PageResult } from './masterData';

// ========== 枚举（prisma/schema/00-enums.prisma） ==========

export type CustomerLevel = 'DIAMOND' | 'STRATEGIC' | 'PREMIUM' | 'NORMAL' | 'POTENTIAL';
export type IntentLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'READY';
export type LeadSource = 'MANUAL' | 'EXCEL' | 'RPA' | 'SYNC';
export type MasterStatus = 'ACTIVE' | 'INACTIVE';
export type Currency = 'CNY' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'HKD' | 'AUD' | 'CAD' | 'KRW' | 'RUB' | 'SEK' | 'NOK' | 'DKK';
export type SalesOrderStatus =
  | 'DRAFT' | 'CONFIRMED' | 'DEPOSIT_PENDING' | 'DEPOSIT_PAID' | 'IN_PRODUCTION'
  | 'QC' | 'READY_TO_SHIP' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED';

/**
 * 列表 `type` 筛选的真实取值（customer.controller）：
 *   · listMy  : public | key | noOrder | noOrder-none | noOrder-A..D | done | done-new | done-old
 *   · listAll : public | key | noOrder | done（与 /my 同分支实现）
 * 未列出的值后端不处理（等同不筛选），因此这里只声明真实分支。
 */
export type CustomerListType =
  | 'public'
  | 'key'
  | 'noOrder' | 'noOrder-none' | 'noOrder-A' | 'noOrder-B' | 'noOrder-C' | 'noOrder-D'
  | 'done' | 'done-new' | 'done-old';

// ========== 关联形状 ==========

/** 列表 / 详情统一使用的 owner 投影（含 role.code） */
export interface CustomerOwner {
  id: string;
  username: string;
  realName: string;
  role: { code: string } | null;
}

/** 商机 include 内的 owner 投影（**不含 role**，与列表 owner 形状不同） */
export interface CustomerOwnerLite {
  id: string;
  username: string;
  realName: string;
}

/** 列表项上的商机摘要投影（仅 intentLevel） */
export interface CustomerOpportunitySummary {
  intentLevel: IntentLevel | null;
}

/** 列表 _count 投影：/my 与 /all 含 opportunities；/public 仅 salesOrders */
export interface CustomerListCount {
  salesOrders: number;
  opportunities?: number;
}

// ========== 列表项 ==========

/** Customer 全量标量字段（列表 include / 详情 include 均返回完整标量行） */
export interface CustomerBase {
  id: string;
  customerNo: string;
  companyName: string;
  englishName: string | null;
  contactName: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  wechat: string | null;
  country: string | null;
  region: string | null;
  customerLevel: CustomerLevel;
  /** 存 CustomerType.name（后端有意不建外键） */
  customerType: string | null;
  source: LeadSource | null;
  tags: string[];
  isKeyAccount: boolean;
  intentLevel: IntentLevel | null;
  notes: string | null;
  /** null = 公海 */
  ownerId: string | null;
  /** ISO string（旧 firstOrderDate:String → DateTime） */
  firstOrderAt: string | null;
  /**
   * ⚠️ **DEAD COLUMN（D-DEAD-FIELDS）**：后端 src/ 全仓零引用（无写入方），恒为 null。
   * 保留在类型中仅为忠实描述 wire 形状；**禁止任何页面读取 / 展示 / 用于计算**。
   */
  lastOrderAt: string | null;
  /**
   * ⚠️ **DEAD COLUMN（D-DEAD-FIELDS）**：后端 src/ 全仓零引用（无写入方），恒为默认 0。
   * 保留在类型中仅为忠实描述 wire 形状；**禁止任何页面读取 / 展示 / 用于计算**。
   */
  totalOrderAmountCny: string | null;
  coverImage: string | null;
  status: MasterStatus;
  createdBy: string | null;
  /** ISO string */
  createdAt: string;
  updatedBy: string | null;
  /** ISO string */
  updatedAt: string;
  /** 软删除时间（ISO string）；列表查询未过滤该字段 */
  deletedAt: string | null;
}

/**
 * 列表项（/public）：Customer 全量标量 + owner + _count{salesOrders} + 商机摘要
 * + orderAgg 附加的 totalAmount / lastOrderDate
 */
export interface CustomerListItem extends CustomerBase {
  owner: CustomerOwner | null;
  _count: CustomerListCount;
  opportunities: CustomerOpportunitySummary[];
  /** 由 SalesOrder.totalAmountCny 聚合得出（后端 Number() 转换 ⇒ number） */
  totalAmount: number;
  /** ISO string；无订单时为 null */
  lastOrderDate: string | null;
}

/** /my 与 /all 的列表项：额外附加 pipelineAmount（商机管道金额合计） */
export interface CustomerPipelineListItem extends CustomerListItem {
  pipelineAmount: number;
}

// ========== 详情（/:id） ==========

/** 详情内的订单明细最小投影（SalesOrderItem select） */
export interface CustomerSalesOrderItem {
  id: string;
  lineNo: number;
  productId: string | null;
  productName: string;
  spec: string | null;
  /** Decimal → JSON string */
  quantity: string;
  unit: string;
  /** Decimal → JSON string */
  unitPrice: string;
  /** Decimal → JSON string */
  amount: string;
  currency: Currency;
}

/** 详情内的订单投影（SalesOrder select，非全字段） */
export interface CustomerSalesOrder {
  id: string;
  orderNo: string;
  status: SalesOrderStatus;
  currency: Currency;
  /** Decimal → JSON string */
  totalAmount: string;
  /** Decimal → JSON string */
  totalAmountCny: string | null;
  /** Decimal → JSON string */
  paidAmountCny: string;
  /** ISO string */
  orderDate: string | null;
  /** ISO string */
  deliveryDate: string | null;
  sampleOrderId: string | null;
  quotationId: string | null;
  /** V1.0 canonical（旧 Order.pipelineId 的对应字段） */
  opportunityId: string | null;
  remark: string | null;
  items: CustomerSalesOrderItem[];
  /** ISO string */
  createdAt: string;
}

/** 详情内的商机（**完整 Opportunity 标量行** + owner 精简投影） */
export interface CustomerOpportunity {
  id: string;
  opportunityNo: string;
  title: string;
  customerId: string;
  leadId: string | null;
  outcome: 'OPEN' | 'WON' | 'LOST';
  /** ISO string */
  outcomeAt: string | null;
  /** ISO string */
  wonAt: string | null;
  lostReason: string | null;
  /** Decimal → JSON string */
  estimatedAmount: string | null;
  currency: Currency;
  /** Decimal → JSON string */
  exchangeRate: string | null;
  /** ISO string */
  estimatedCloseDate: string | null;
  intentLevel: IntentLevel | null;
  /** Decimal → JSON string（50.00 = 50%） */
  probability: string | null;
  notes: string | null;
  ownerId: string | null;
  owner: CustomerOwnerLite | null;
  createdBy: string | null;
  /** ISO string */
  createdAt: string;
  updatedBy: string | null;
  /** ISO string */
  updatedAt: string;
}

/** 详情内的客户动态（**完整 CustomerActivity 行**，后端 take: 50，升序） */
export interface CustomerActivity {
  id: string;
  customerId: string;
  /** CLAIM / RELEASE / CREATED / UPDATED / KEY_TOGGLE / INTENT_CHANGE */
  action: string;
  detail: string | null;
  summary: string | null;
  diff: string | null;
  realName: string | null;
  createdBy: string;
  /** ISO string */
  createdAt: string;
}

/** 客户详情（GET /api/customers/:id） */
export interface CustomerDetail extends CustomerBase {
  owner: CustomerOwner | null;
  salesOrders: CustomerSalesOrder[];
  opportunities: CustomerOpportunity[];
  activities: CustomerActivity[];
}

// ========== 统计形状 ==========

/** /my 的 stats（getCustomerStats：传 ownerId 时口径为本人） */
export interface CustomerMyStats {
  total: number;
  newCount: number;
  oldCount: number;
  noOrderCount: number;
  keyCount: number;
  intentBreakdown: { level: IntentLevel | null; count: number }[];
}

/** /all 的 stats（后端另行计算的 4 个计数，**不含** noOrderCount / intentBreakdown） */
export interface CustomerAllStats {
  total: number;
  newCount: number;
  oldCount: number;
  keyCount: number;
}

/** /my 与 /all 的子筛选计数（getSubFilterCounts 展开为顶层键） */
export interface CustomerSubFilterCounts {
  /** 未成交：''（合计）/ A / B / C / D / none */
  noOrderBreakdown: { '': number; A: number; B: number; C: number; D: number; none: number };
  /** 已成交：''（合计）/ new / old */
  doneBreakdown: { '': number; new: number; old: number };
}

/** 商机意向金额分布（opportunity.groupBy，Decimal 以 string 返回） */
export interface CustomerEstimatedBreakdownItem {
  intentLevel: IntentLevel | null;
  _sum: { estimatedAmount: string | null };
  _count: number;
}

/** 成交金额分布（后端显式构造） */
export interface CustomerContractBreakdownItem {
  type: '新客户' | '老客户';
  amount: number;
}

/** /all 的业务员统计 */
export interface CustomerOwnerStat {
  id: string;
  username: string;
  realName: string;
  customerCount: number;
  keyCount: number;
}

// ========== 查询参数（三个端点各自独立，不混合） ==========

/** 分页基类（与 masterData.PageResult 对齐） */
export interface PageQuery {
  page?: number;
  pageSize?: number;
}

/** GET /api/customers/my —— 后端解构：keyword, type, country, page, pageSize（**无 ownerId**） */
export interface CustomerMyQuery extends PageQuery {
  keyword?: string;
  type?: CustomerListType;
  country?: string;
}

/** GET /api/customers/public —— 后端解构：keyword, country, page, pageSize */
export interface CustomerPublicQuery extends PageQuery {
  keyword?: string;
  country?: string;
}

/** GET /api/customers/all —— 后端解构：keyword, ownerId, type, country, page, pageSize */
export interface CustomerAllQuery extends PageQuery {
  keyword?: string;
  ownerId?: string;
  type?: CustomerListType;
  country?: string;
}

/** GET /api/customers/report —— 后端不解析任何 query（仅按 caller 数据范围统计） */
export type CustomerReportQuery = Record<string, never>;

// ========== 写入请求（Round F-8 冻结范围） ==========

/**
 * POST /api/customers 请求体（F-8 冻结：**仅**以下字段可提交）
 *
 * 明确**不含**（Create 不开放 / 后端 create 载荷不持久化）：
 *   customerLevel · firstOrderAt / firstOrderDate · englishName · position · wechat · region
 * 依据：customer.controller create payload（L820-840）与 D-CUSTOMER-LEVEL / D-FIRST-ORDER。
 */
export interface CustomerCreateRequest {
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  customerType?: string | null;
  // D-SOURCE-2（F-8G-D 冻结）：Create 请求体**不含** source —— 手工创建的 source 由后端 API 固定为 MANUAL
  tags?: string[];
  notes?: string | null;
  coverImage?: string | null;
  isKeyAccount?: boolean;
  // D-INTENT v2（F-8C）：Customer.intentLevel **不是可写字段** —— 后端按关联 Opportunity.intentLevel
  // 读取时派生 ⇒ Create 请求体不含 intentLevel（不可人工选择 / 清空 / 提交）。
  /**
   * undefined = 归当前登录用户；null = 公海。
   * ⚠️ **禁止**填入其他用户 id（F-01 已冻结：候选源缺失，owner 指派 BLOCKED）。
   */
  ownerId?: string | null;
}

/**
 * PUT /api/customers/:id 请求体（F-8 冻结：Edit 可写字段，以后端 update 载荷为准）
 *
 * ownerId：undefined = 保持当前归属；null = 移入公海；**禁止**指定其他用户（F-01）。
 * firstOrderAt：人工字段（`YYYY-MM-DD` 字符串 / null 清空）；后端不回写、不派生（D-FIRST-ORDER）。
 */
export interface CustomerUpdateRequest {
  companyName?: string;
  contactName?: string | null;
  englishName?: string | null;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  wechat?: string | null;
  country?: string | null;
  region?: string | null;
  coverImage?: string | null;
  customerLevel?: CustomerLevel;
  customerType?: string | null;
  // D-SOURCE-4（F-8G-D 冻结）：Update 请求体**不含** source —— 普通 update 不得修改 Customer.source
  notes?: string | null;
  tags?: string[];
  isKeyAccount?: boolean;
  // D-INTENT v2（F-8C）：Customer.intentLevel 非可写字段（后端由关联商机派生）⇒ Update 请求体不含 intentLevel
  firstOrderAt?: string | null;
  ownerId?: string | null;
}

// ========== 响应形状（各端点差异必须保留） ==========

/** /my：分页 + 统计 + 子筛选计数 + 金额聚合 */
export interface CustomerMyResponse extends PageResult<CustomerPipelineListItem> {
  stats: CustomerMyStats;
  noOrderBreakdown: CustomerSubFilterCounts['noOrderBreakdown'];
  doneBreakdown: CustomerSubFilterCounts['doneBreakdown'];
  /**
   * 后端写法 `_sum.estimatedAmount || 0`：非空 Decimal 直接透传 ⇒ JSON 序列化为 **string**；
   * 为空时落到数字 0。故此处为联合类型（运行期实测值见 F-5 报告）。
   */
  estimatedAmount: string | number;
  /** 后端 `Number(... ?? 0)` ⇒ number */
  totalContractAmount: number;
  estimatedBreakdown: CustomerEstimatedBreakdownItem[];
  contractBreakdown: CustomerContractBreakdownItem[];
}

/** /public：仅分页（后端不返回任何统计字段） */
export type CustomerPublicResponse = PageResult<CustomerListItem>;

/** /all：分页 + ownerStats + publicCount + 子筛选计数 + 两套 stats + 金额聚合 */
export interface CustomerAllResponse extends PageResult<CustomerPipelineListItem> {
  ownerStats: CustomerOwnerStat[];
  publicCount: number;
  noOrderBreakdown: CustomerSubFilterCounts['noOrderBreakdown'];
  doneBreakdown: CustomerSubFilterCounts['doneBreakdown'];
  /** 注意：/all 的 stats 形状与 /my 不同（见 CustomerAllStats） */
  stats: CustomerAllStats;
  estimatedAmount: string | number;
  totalContractAmount: number;
  estimatedBreakdown: CustomerEstimatedBreakdownItem[];
  contractBreakdown: CustomerContractBreakdownItem[];
}

/**
 * 客户选项投影（GET /api/customers/options）—— **F-S2 additive**
 *
 * 后端既有端点（server/src/controllers/customer.controller.ts `listOptions`）：按 `roleScope(req)` 过滤后
 * 返回 { id, companyName, contactName, customerNo, email, phone, country, ownerId }，**无分页**。
 * 该端点在 F-4A 已被判定为 page-level 数据集（不进入 master data store），故此处仅补类型声明，
 * 不改变任何 Customer 业务规则 / 契约（本类型为纯读取用）。
 */
export interface CustomerOption {
  id: string;
  companyName: string;
  contactName: string | null;
  customerNo: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  ownerId: string | null;
}

/** /report：管道与转化统计（与 list stats **不同**，独立定义） */
export interface CustomerReport {
  leadCount: number;
  opportunityCount: number;
  sampleOrderCount: number;
  pipelineOrderCount: number;
  newCustomerCount: number;
  oldCustomerCount: number;
  newCustomerAmount: number;
  oldCustomerAmount: number;
  /** 百分比整数（Math.round 后的百分数） */
  leadToOpportunity: number;
  opportunityToNext: number;
  sampleToOrder: number;
  leadToOrder: number;
}
