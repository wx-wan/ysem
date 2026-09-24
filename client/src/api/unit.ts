import request, { ApiResponse } from './request';

export interface Unit {
  id: string;
  name: string; // 如 个 / 套
  isActive: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface UnitInput {
  name: string;
  isActive?: boolean;
  sort?: number;
}

export const unitApi = {
  getActive: () => request.get<ApiResponse<Unit[]>>('/units/active').then((r) => r.data.data),
  getAll: (keyword?: string) =>
    request
      .get<ApiResponse<Unit[]>>(`/units${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`)
      .then((r) => r.data.data),
  getById: (id: string) => request.get<ApiResponse<Unit>>(`/units/${id}`).then((r) => r.data.data),
  create: (data: UnitInput) => request.post<ApiResponse<Unit>>('/units', data).then((r) => r.data.data),
  update: (id: string, data: Partial<UnitInput>) => request.put<ApiResponse<Unit>>(`/units/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/units/${id}`).then(() => undefined),
  updateSort: (items: { id: string; sort: number }[]) => request.put<ApiResponse<null>>('/units/sort', items).then(() => undefined),
};
