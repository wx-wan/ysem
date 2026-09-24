import request, { ApiResponse } from './request';

export interface CurrencyRate {
  id: string;
  code: string; // ISO 4217，如 CNY / USD
  name: string; // 中文名
  symbol: string;
  isActive: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyInput {
  code: string;
  name: string;
  symbol?: string;
  isActive?: boolean;
  sort?: number;
}

export const currencyApi = {
  getActive: () => request.get<ApiResponse<CurrencyRate[]>>('/currencies/active').then((r) => r.data.data),
  getAll: (keyword?: string) =>
    request
      .get<ApiResponse<CurrencyRate[]>>(`/currencies${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`)
      .then((r) => r.data.data),
  getById: (id: string) => request.get<ApiResponse<CurrencyRate>>(`/currencies/${id}`).then((r) => r.data.data),
  create: (data: CurrencyInput) => request.post<ApiResponse<CurrencyRate>>('/currencies', data).then((r) => r.data.data),
  update: (id: string, data: Partial<CurrencyInput>) =>
    request.put<ApiResponse<CurrencyRate>>(`/currencies/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => request.delete<ApiResponse<null>>(`/currencies/${id}`).then(() => undefined),
  updateSort: (items: { id: string; sort: number }[]) =>
    request.put<ApiResponse<null>>('/currencies/sort', items).then(() => undefined),
};
