import request, { type ApiResponse } from './request';

export interface Certificate {
  id: string;
  name: string;
  code?: string | null;
  issuer?: string | null;
  category?: string | null;
  validUntil?: string | null;
  status: number;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const certificateApi = {
  list: () => request.get<ApiResponse<Certificate[]>>('/certificates'),
  get: (id: string) => request.get<Certificate>(`/certificates/${id}`),
  create: (data: Partial<Certificate>) => request.post<Certificate>('/certificates', data),
  update: (id: string, data: Partial<Certificate>) => request.put(`/certificates/${id}`, data),
  delete: (id: string) => request.delete(`/certificates/${id}`),
};
