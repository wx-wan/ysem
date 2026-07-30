import request from './request';

// ========== 类型定义 ==========
export interface Customer {
  id: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  country?: string;
  source?: string;
  notes?: string;
  ownerId?: string;
  isKeyAccount: boolean;
  intentLevel?: string;
  firstOrderDate?: string;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; username: string; realName: string };
  _count?: { orders: number; pipelines: number };
  orders?: Order[];
  pipelines?: any[];
  activities?: CustomerActivity[];
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

export interface CustomerListRes {
  list: Customer[];
  total: number;
  page: number;
  pageSize: number;
  stats?: CustomerStats;
}

export interface AllCustomersRes extends CustomerListRes {
  ownerStats: { id: string; username: string; realName: string; customerCount: number; keyCount: number }[];
  publicCount: number;
  stats: CustomerStats;
}

export interface Order {
  id: string;
  customerId: string;
  orderNo?: string;
  orderDate?: string;
  amountCNY?: number;
  deliveryDate?: string;
  paymentTerms?: string;
  status?: string;
  notes?: string;
  customer?: { id: string; companyName: string; contactName?: string; ownerId?: string; email?: string; phone?: string; country?: string };
  createdAt: string;
  updatedAt: string;
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
  // 我的私海客户
  listMy: (params?: Record<string, any>) =>
    request.get<CustomerListRes>('/customers/my', { params }),

  // 公海客户
  listPublic: (params?: Record<string, any>) =>
    request.get<{ list: Customer[]; total: number; page: number; pageSize: number }>('/customers/public', { params }),

  // 管理员：所有客户
  listAll: (params?: Record<string, any>) =>
    request.get<AllCustomersRes>('/customers/all', { params }),

  // 国家列表
  getCountries: () =>
    request.get<string[]>('/customers/countries'),

  // 详情
  getById: (id: string) =>
    request.get<Customer>(`/customers/${id}`),

  // 创建
  create: (data: Partial<Customer>) =>
    request.post<Customer>('/customers', data),

  // 更新
  update: (id: string, data: Partial<Customer>) =>
    request.put<Customer>(`/customers/${id}`, data),

  // 删除
  remove: (id: string) =>
    request.delete(`/customers/${id}`),

  // 认领
  claim: (id: string) =>
    request.post(`/customers/${id}/claim`),

  // 释放到公海
  release: (id: string) =>
    request.post(`/customers/${id}/release`),

  // Excel 导入
  importExcel: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return request.post<{ created: number; failed: number }>('/customers/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  // 报告统计
  report: () =>
    request.get<{
      leadCount: number;
      opportunityCount: number;
      sampleCount: number;
      pipelineOrderCount: number;
      newCustomerCount: number;
      oldCustomerCount: number;
      newCustomerAmount: number;
      oldCustomerAmount: number;
      leadToOpportunity: number;
      opportunityToNext: number;
      sampleToOrder: number;
      leadToOrder: number;
    }>('/customers/report'),
};

// ========== 订单 API ==========
export const orderApi = {
  list: (params?: Record<string, any>) =>
    request.get<OrderListRes>('/orders', { params }),

  getById: (id: string) =>
    request.get<Order>(`/orders/${id}`),

  create: (data: Partial<Order>) =>
    request.post<Order>('/orders', data),

  update: (id: string, data: Partial<Order>) =>
    request.put<Order>(`/orders/${id}`, data),

  remove: (id: string) =>
    request.delete(`/orders/${id}`),

  listByCustomer: (customerId: string) =>
    request.get<Order[]>(`/orders/customer/${customerId}`),
};
