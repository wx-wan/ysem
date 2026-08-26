import request, { ApiResponse } from './request';

export interface CustomerType {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerTypeInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  sort?: number;
}

const customerTypeApi = {
  /** 获取启用的客户类型（下拉选择用） */
  getActive: () => request.get<ApiResponse<CustomerType[]>>('/customer-types/active'),

  /** 获取全部客户类型（设置页管理用，支持搜索） */
  getAll: (keyword?: string) =>
    request.get<ApiResponse<CustomerType[]>>(
      `/customer-types${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`,
    ),

  getById: (id: string) => request.get<ApiResponse<CustomerType>>(`/customer-types/${id}`),

  create: (data: CustomerTypeInput) =>
    request.post<ApiResponse<CustomerType>>('/customer-types', data),

  update: (id: string, data: CustomerTypeInput) =>
    request.put<ApiResponse<CustomerType>>(`/customer-types/${id}`, data),

  delete: (id: string) => request.delete<ApiResponse<null>>(`/customer-types/${id}`),

  updateSort: (items: { id: string; sort: number }[]) =>
    request.put<ApiResponse<null>>('/customer-types/sort', items),
};

export default customerTypeApi;
