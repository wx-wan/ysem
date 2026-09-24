import request, { ApiResponse } from './request';

export interface CommunicationTool {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommunicationToolInput {
  name?: string;
  description?: string;
  isActive?: boolean;
  sort?: number;
}

const commToolApi = {
  /** 获取启用的沟通工具（下拉选择用） */
  getActive: () => request.get<ApiResponse<CommunicationTool[]>>('/comm-tools/active'),

  /** 获取全部沟通工具（设置页管理用，支持搜索） */
  getAll: (keyword?: string) =>
    request.get<ApiResponse<CommunicationTool[]>>(
      `/comm-tools${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`,
    ),

  getById: (id: string) => request.get<ApiResponse<CommunicationTool>>(`/comm-tools/${id}`),

  create: (data: CommunicationToolInput) =>
    request.post<ApiResponse<CommunicationTool>>('/comm-tools', data),

  update: (id: string, data: CommunicationToolInput) =>
    request.put<ApiResponse<CommunicationTool>>(`/comm-tools/${id}`, data),

  delete: (id: string) => request.delete<ApiResponse<null>>(`/comm-tools/${id}`),

  updateSort: (items: { id: string; sort: number }[]) =>
    request.put<ApiResponse<null>>('/comm-tools/sort', items),
};

export default commToolApi;
