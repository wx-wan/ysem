import request from './request';
import type { ApiResponse } from './request';

// ========== 类型定义 ==========
export interface Customer {
  id: string;
  customerCode?: string; // 客户编号 CUS-YYMMDD-序号
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
  firstOrderDate?: string;
  estimatedAmount?: number;
  status?: string; // lead / prospect / sample / order
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; username: string; realName: string; role?: { code: string } };
  _count?: { orders: number; pipelines: number };
  orders?: Order[];
  pipelines?: any[];
  activities?: CustomerActivity[];
  totalAmount?: number;
  lastOrderDate?: string | null;
  pipelineAmount?: number;
}

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

export interface OrderItem {
  productId?: string;
  name?: string;
  spec?: string;
  quantity?: number;
  unitPrice?: number;
  amount?: number;
  pipelineId?: string;
}

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

// ========== 订单 API（legacy，残留 dead-only 部分）==========
// 【Round 3B-3-5-6b-1】3 个 LIVE 消费者（ProductDetailModal / customer·OrderFormModal /
// CreateOrderFromProductModal）已全部迁移到 V1.0 `/api/quotations` · `/api/sample-orders`
// · `/api/sales-orders` → **本 orderApi 的 live caller = 0**。
//
// 已删除（迁出后 caller=0）：`update` · `remove` · `listByCustomer`。
//
// 以下方法**保留**，但仅剩 `pages/Orders.tsx` 一个引用方；该页面在 `App.tsx` 中只有 import、
// **没有任何 Route**（不可达），且删除它需要同步修改 `client/src/App.tsx`（本轮未授权文件），
// 故按 Scope Gate 保留。清理归属后续 Slice（Unified Order Backend Retirement / 3B-3-5-6b-2）。
// 注：legacy 后端 `/api/orders` 的所有 handler 因 `Order` 模型已从 schema 移除而在运行期必然 500，
// 这些残留方法即使被调用也不会成功。
export const orderApi = {
  list: (params?: Record<string, any>) =>
    request.get<ApiResponse<OrderListRes>>('/orders', { params }),

  getById: (id: string) =>
    request.get<ApiResponse<Order>>(`/orders/${id}`),

  create: (data: Partial<Order>) =>
    request.post<ApiResponse<Order>>('/orders', data),

  submit: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/submit`),

  approve: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/approve`),

  reject: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/reject`),
};
