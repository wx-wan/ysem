import request from './request';

export interface User {
  id: string;
  username: string;
  realName: string | null;
  email: string;
  phone: string | null;
  status: string;
  role: string;
  department: string | null;
}

export const userApi = {
  list: (params?: { page?: number; pageSize?: number; keyword?: string }) =>
    request.get<{ list: User[]; total: number }>('/users', { params }),
};
