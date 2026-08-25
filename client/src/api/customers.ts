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
  customerLevel?: string; // 客户等级
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

// 付款单（收款记录）
export interface PaymentRecord {
  id: string;
  orderId: string;
  customerId: string;
  paymentNo?: string;
  payDate?: string;
  amount?: number;        // 本次收款金额
  ratio?: number;         // 收款比例（%）
  method?: string;        // 收款方式
  status?: 'RECEIVED' | 'PENDING';
  remark?: string;
  customer?: { id: string; companyName: string };
  order?: { id: string; orderNo?: string; title?: string };
  createdAt: string;
  updatedAt: string;
}

// 利润单（利润核算）
export interface ProfitRecord {
  id: string;
  orderId: string;
  customerId: string;
  profitNo?: string;
  revenue?: number;       // 收入
  cost?: number;          // 成本
  profit?: number;        // 利润
  margin?: number;        // 利润率（%）
  currency?: string;
  remark?: string;
  customer?: { id: string; companyName: string };
  order?: { id: string; orderNo?: string; title?: string };
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

// ========== 订单 API ==========
export const orderApi = {
  list: (params?: Record<string, any>) =>
    request.get<ApiResponse<OrderListRes>>('/orders', { params }),

  getById: (id: string) =>
    request.get<ApiResponse<Order>>(`/orders/${id}`),

  create: (data: Partial<Order>) =>
    request.post<ApiResponse<Order>>('/orders', data),

  update: (id: string, data: Partial<Order>) =>
    request.put<ApiResponse<Order>>(`/orders/${id}`, data),

  remove: (id: string) =>
    request.delete<ApiResponse<any>>(`/orders/${id}`),

  listByCustomer: (customerId: string) =>
    request.get<ApiResponse<Order[]>>(`/orders/customer/${customerId}`),

  submit: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/submit`),

  approve: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/approve`),

  reject: (id: string) =>
    request.post<ApiResponse<Order>>(`/orders/${id}/reject`),
};

// ========== 付款单 API（收款记录） ==========
export const paymentApi = {
  list: (params?: Record<string, any>) =>
    request.get<ApiResponse<PaymentRecord[]>>('/orders/payments', { params }),
  create: (data: Partial<PaymentRecord>) =>
    request.post<ApiResponse<PaymentRecord>>('/orders/payments', data),
  update: (id: string, data: Partial<PaymentRecord>) =>
    request.put<ApiResponse<PaymentRecord>>(`/orders/payments/${id}`, data),
  remove: (id: string) =>
    request.delete<ApiResponse<any>>(`/orders/payments/${id}`),
};

// ========== 利润单 API（利润核算） ==========
export const profitApi = {
  list: (params?: Record<string, any>) =>
    request.get<ApiResponse<ProfitRecord[]>>('/orders/profits', { params }),
  create: (data: Partial<ProfitRecord>) =>
    request.post<ApiResponse<ProfitRecord>>('/orders/profits', data),
  update: (id: string, data: Partial<ProfitRecord>) =>
    request.put<ApiResponse<ProfitRecord>>(`/orders/profits/${id}`, data),
  remove: (id: string) =>
    request.delete<ApiResponse<any>>(`/orders/profits/${id}`),
};
