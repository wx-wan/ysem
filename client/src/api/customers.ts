import request from './request';
import type { ApiResponse } from './request';

// ========== 类型定义 ==========
export interface Customer {
  id: string;
  customerNo?: string; // 客户编号 CUS-yyyyMMdd-####（V1.0 canonical 字段名）
  companyName: string;
  contactName?: string;
  englishName?: string;   // 英文名
  position?: string;      // 职位
  email?: string;
  phone?: string;
  wechat?: string;        // 微信
  country?: string;
  region?: string;        // 所在地区（省市区）
  images?: string;        // 客户参考图片（JSON 数组 [{url,name}]）
  customerLevel?: string; // 客户等级
  customerType?: string; // 客户类型
  source?: string;
  channelId?: string | null; // 获客渠道（与 Lead.channelId 同义）
  shopId?: string | null; // 获客平台（与 Lead.shopId 同义）
  contactMethods?: { tool: string; account: string }[] | null; // 联系方式（与 Lead.contactMethods 一致：[{tool, account}]）
  sourceKey?: string; // 来源组合值（JSON {channelId, shopId}），建档时拆分落库
  notes?: string;
  ownerId?: string;
  isKeyAccount: boolean;
  intentLevel?: string;
  tags?: string[];   // V1.0 canonical：PG 原生数组（GET 返回 string[]；写入亦传数组）
  /** V1.0 canonical：首次下单时间（Prisma DateTime → ISO 字符串）；由履约层回写，null = 无成交 */
  firstOrderAt?: string | null;
  estimatedAmount?: number;
  status?: string; // lead / prospect / sample / order
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; username: string; realName: string; role?: { code: string } };
  /**
   * V1.0 canonical：Customer._count（各 endpoint 提供情况不同 → 全部 optional）
   *   · listMy / listAll → { salesOrders, opportunities }
   *   · listPublic      → 仅 { salesOrders }
   *   · getById         → 不返回 _count
   */
  _count?: {
    salesOrders?: number;
    opportunities?: number;
  };
  /** V1.0 canonical：客户销售订单（仅 getById 返回，投影见 Round 3C-2-1） */
  salesOrders?: SalesOrderSummary[];
  /** V1.0 canonical：客户商机（getById 返回完整对象；list 端点仅 `{ intentLevel }` 投影） */
  opportunities?: OpportunitySummary[];
  activities?: CustomerActivity[];
  totalAmount?: number;
  lastOrderDate?: string | null;
  pipelineAmount?: number;
}

// ========== V1.0 关系 summary 类型（对应 server 实际投影）==========

/** Customer getById 的 `salesOrders[].items[]` 投影（Round 3C-2-1 冻结的最小必要字段） */
export interface SalesOrderItemSummary {
  id: string;
  lineNo: number;
  productId?: string | null;
  productName: string;
  spec?: string | null;
  /** Prisma Decimal → JSON string（沿用现有 API contract，不改为 number） */
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  currency: string;
}

/** Customer getById 的 `salesOrders[]` 投影（字段清单与 server select 严格一致） */
export interface SalesOrderSummary {
  id: string;
  orderNo: string;
  status: string;
  currency: string;
  /** 原币金额（Decimal → string） */
  totalAmount: string;
  /** 本位币金额（Decimal → string | null） */
  totalAmountCny?: string | null;
  /** 已收累计（本位币，Decimal → string；payment IN+CONFIRMED 汇总回写） */
  paidAmountCny: string;
  orderDate?: string | null;
  deliveryDate?: string | null;
  /** 来源打样单（V1.0：旧 `Order.type === 'SAMPLE'` 的 canonical 表达） */
  sampleOrderId?: string | null;
  quotationId?: string | null;
  /** V1.0 canonical（旧 `Order.pipelineId` 的对应字段） */
  opportunityId: string;
  remark?: string | null;
  items?: SalesOrderItemSummary[];
  createdAt: string;
}

/**
 * 客户商机投影。
 * getById 返回完整 Opportunity 对象；list 端点仅返回 `{ intentLevel }` 投影
 * ⇒ 除 `id` 外全部 optional，禁止假设所有 endpoint 都返回完整对象。
 */
export interface OpportunitySummary {
  id: string;
  /** 商机编号 BO-yyyyMMdd-####（list 端点不返回） */
  opportunityNo?: string;
  title?: string;
  /** 采购意向等级（V1.0 canonical；list 与 getById 均返回） */
  intentLevel?: IntentLevelCode | null;
  /** 0~100 百分数（Decimal → string）；仅作 `intentLevel` 缺失时的兼容回退 */
  probability?: string | null;
  estimatedAmount?: string | number | null;
  estimatedCloseDate?: string | null;
  ownerId?: string | null;
  owner?: { id: string; realName?: string; username?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

/** V1.0 商机采购意向等级（对齐 Prisma `IntentLevel` enum） */
export type IntentLevelCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'READY';

export interface CustomerActivity {
  id: string;
  customerId: string;
  action: string;
  detail?: string;
  createdBy: string;
  createdAt: string;
}

export interface CustomerStats {
  total: number;
  newCount: number;
  oldCount: number;
  noOrderCount: number;
  keyCount: number;
  intentBreakdown: { level: string; count: number }[];
}

export interface EstimatedBreakdownItem {
  probability: string;
  _count: number;
  _sum: { estimatedAmount: number | null };
}

export interface ContractBreakdownItem {
  type: string;
  amount: number;
}

export interface CustomerListRes {
  list: Customer[];
  total: number;
  page: number;
  pageSize: number;
  stats?: CustomerStats;
  estimatedAmount?: number;
  totalContractAmount?: number;
  estimatedBreakdown?: EstimatedBreakdownItem[];
  contractBreakdown?: ContractBreakdownItem[];
  noOrderBreakdown?: Record<string, number>;
  doneBreakdown?: Record<string, number>;
}

export interface AllCustomersRes extends CustomerListRes {
  ownerStats: { id: string; username: string; realName: string; customerCount: number; keyCount: number }[];
  publicCount: number;
  stats: CustomerStats;
}


// 归属查询返回结果（仅 code + 命中客户主键 + 负责人姓名，无具体客户资料）
export type OwnershipCode = 'NOT_FOUND' | 'OWNED_BY_ME' | 'OWNED_BY_OTHER' | 'IN_PUBLIC_SEA';
export interface OwnershipResult {
  code: OwnershipCode;
  customerId?: string;
  ownerName?: string;
}

// ========== 客户 API ==========
export const customerApi = {
  listMy: (params?: Record<string, any>) =>
    request.get<ApiResponse<CustomerListRes>>('/customers/my', { params }),

  listPublic: (params?: Record<string, any>) =>
    request.get<ApiResponse<{ list: Customer[]; total: number; page: number; pageSize: number }>>('/customers/public', { params }),

  listAll: (params?: Record<string, any>) =>
    request.get<ApiResponse<AllCustomersRes>>('/customers/all', { params }),

  // 客户下拉选项：我的私海 + 公海（管理员为全部）
  options: () =>
    request.get<ApiResponse<Customer[]>>('/customers/options'),

  getCountries: () =>
    request.get<ApiResponse<string[]>>('/customers/countries'),

  /**
   * 轻量归属查询：给定公司名称，跨全员检索（后端不套数据权限），
   * 仅返回归属状态码 + 命中客户主键 + 负责人姓名，不返回具体客户资料。
   * 用于线索表单 onBlur 时判定「未建档 / 本人已建档 / 他人负责 / 公海」。
   */
  checkOwnership: (companyName: string) =>
    request.get<ApiResponse<OwnershipResult>>('/customers/ownership', { params: { companyName } }),

  getById: (id: string) =>
    request.get<ApiResponse<Customer>>(`/customers/${id}`),

  create: (data: Partial<Customer>) =>
    request.post<ApiResponse<Customer>>('/customers', data),

  update: (id: string, data: Partial<Customer>) =>
    request.put<ApiResponse<Customer>>(`/customers/${id}`, data),

  remove: (id: string) =>
    request.delete<ApiResponse<any>>(`/customers/${id}`),

  claim: (id: string) =>
    request.post<ApiResponse<any>>(`/customers/${id}/claim`),

  release: (id: string) =>
    request.post<ApiResponse<any>>(`/customers/${id}/release`),

  transfer: (id: string, newOwnerId: string) =>
    request.post<ApiResponse<any>>(`/customers/${id}/transfer`, { newOwnerId }),

  importExcel: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request.post<ApiResponse<{ created: number; failed: number }>>('/customers/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // 专用的标签更新接口（body 保持数组 string[]，不在 API 层转逗号字符串）
  updateTags: (id: string, tags: string[]) =>
    request.patch<ApiResponse<Customer>>(`/customers/${id}/tags`, { tags }),

  report: () =>
    request.get<ApiResponse<{
      leadCount: number;
      opportunityCount: number;
      sampleOrderCount: number;
      pipelineOrderCount: number;
      newCustomerCount: number;
      oldCustomerCount: number;
      newCustomerAmount: number;
      oldCustomerAmount: number;
      leadToOpportunity: number;
      opportunityToNext: number;
      sampleToOrder: number;
      leadToOrder: number;
    }>>('/customers/report'),
};

// 说明（Round 3B-3-5-6b-2）：legacy 统一订单 API 对象已随 Unified Order Backend 正式退休删除。
//
// 说明（Round 3C-2-2 / 3C-2-3）：Customer 域已完成 V1.0 canonical 收口 ——
//   · 关系：`Customer.salesOrders: SalesOrderSummary[]` / `Customer.opportunities: OpportunitySummary[]`
//   · 计数：`Customer._count.{salesOrders, opportunities}`（均 optional，随 endpoint 而异）
//   · 首单：`Customer.firstOrderAt`（DateTime → ISO 字符串；scalar，全端点返回）
//   · 共享逻辑：purchaseStatus / intentLevel / utils / customerTier 全部走 canonical 数据源
//
// legacy Customer 统一订单形状（`Order` / `OrderItem` / `OrderListRes` 类型，以及
// `Customer.orders` / `Customer.pipelines` / `Customer.firstOrderDate` /
// `_count.{orders,pipelines}` 成员）已于 Round 3C-2-3 **全部删除**（零残留）。
// V1.0 对应关系：orders→salesOrders · pipelines→opportunities ·
// firstOrderDate→firstOrderAt · amountCNY→totalAmountCny · pipelineId→opportunityId。
