import request from './request';
import type { ApiResponse } from './request';

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

  report: () =>
    request.get<ApiResponse<{
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
};
