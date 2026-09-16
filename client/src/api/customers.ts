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
  notes?: string;
  ownerId?: string;
  isKeyAccount: boolean;
  intentLevel?: string;
  tags?: string;     // 逗号分隔的标签
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
    /** @deprecated 3C-2-3 移除（旧键名，server 已不返回） */
    orders?: number;
    /** @deprecated 3C-2-3 移除（旧键名，server 已不返回） */
    pipelines?: number;
  };
  /** V1.0 canonical：客户销售订单（仅 getById 返回，投影见 Round 3C-2-1） */
  salesOrders?: SalesOrderSummary[];
  /** V1.0 canonical：客户商机（getById 返回完整对象；list 端点仅 `{ intentLevel }` 投影） */
  opportunities?: OpportunitySummary[];
  activities?: CustomerActivity[];
  totalAmount?: number;
  lastOrderDate?: string | null;
  pipelineAmount?: number;

  // ========== legacy 过渡声明（3C-2-3 随 Customer UI 迁移一并移除）==========
  // CustomerCard / CustomerOverview / CustomerDetailModal / CustomerFormModal /
  // CustomerEditDrawer（Round 3C-2-2 禁止修改）仍直接读取以下字段；
  // 在 UI 迁移前删除会导致 client TS 非 0，故暂予保留。
  /** @deprecated 3C-2-3 移除 → 改用 `firstOrderAt` */
  firstOrderDate?: string;
  /** @deprecated 3C-2-3 移除 → 改用 `salesOrders` */
  orders?: Order[];
  /** @deprecated 3C-2-3 移除 → 改用 `opportunities` */
  pipelines?: any[];
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

/**
 * @deprecated 【3C-2-3 移除】legacy 统一订单类型。
 * 仍被 CustomerDetailModal（`Order` 类型 import + `renderOrderItem`）与
 * Customer 域过渡成员 `Customer.orders` 引用；Customer UI 迁移完成后删除。
 */
export interface Order {
  id: string;
  type?: 'QUOTE' | 'SAMPLE' | 'ORDER' | 'PRODUCTION' | 'SHIPPED';
  title?: string;
  customerId: string;
  orderNo?: string;
  orderDate?: string;
  amountCNY?: number;
  currency?: string;
  depositAmount?: number;
  depositPaid?: boolean;
  deliveryDate?: string;
  paymentTerms?: string;
  // 审批态（报价/打样/订单通用）
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | null;
  // 打样阶段（仅 SAMPLE）：设计 → 开模 → 寄样
  stage?: 'DESIGN' | 'MOLD' | 'SAMPLE_SENT' | null;
  items?: string | OrderItem[];
  targetType?: 'PRODUCT' | 'GROUP' | null;
  targetId?: string;
  pipelineId?: string;
  sampleOrderDate?: string;
  designDate?: string;
  moldDate?: string;
  sampleSentDate?: string;
  productionStartDate?: string;
  shippedDate?: string;
  remark?: string;
  customer?: { id: string; companyName: string; contactName?: string; ownerId?: string; email?: string; phone?: string; country?: string };
  createdAt: string;
  updatedAt: string;
}

/** @deprecated 【3C-2-3 移除】legacy 订单明细（旧 JSON items 语义） */
export interface OrderItem {
  productId?: string;
  name?: string;
  spec?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  pipelineId?: string;
}

/** @deprecated 【3C-2-3 移除】legacy 订单列表响应（当前零消费者） */
export interface OrderListRes {
  list: Order[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: number;
  totalCount: number;
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

  // 专用的标签更新接口
  updateTags: (id: string, tags: string) =>
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
// 说明（Round 3C-2-2）：V1.0 canonical 关系与类型已就位 —— `Customer.firstOrderAt` /
// `Customer.salesOrders: SalesOrderSummary[]` / `Customer.opportunities: OpportunitySummary[]` /
// `Customer._count.{salesOrders,opportunities}`；共享逻辑（purchaseStatus / intentLevel /
// utils / customerTier）已全部切换到 V1.0 canonical 数据源。
//
// 仍未移除（3C-2-3 随 Customer UI 语义迁移一并删除）：
//   · 类型：Order / OrderItem / OrderListRes
//   · 成员：Customer.orders / Customer.pipelines / Customer.firstOrderDate / _count.{orders,pipelines}
// 原因：CustomerCard / CustomerOverview / CustomerDetailModal / CustomerFormModal /
//       CustomerEditDrawer（3C-2-2 禁止修改）仍直接读取上述成员；提前删除会使 client TS 非 0。
