import request from './request';

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    realName: string;
    email: string;
    phone: string;
    avatar: string;
    role: { id: string; name: string; code: string } | null;
    departmentId: string;
  };
}

export const authApi = {
  login: (data: LoginParams) =>
    request.post<LoginParams, { data: { code: number; data: LoginResult } }>('/auth/login', data),

  logout: () => request.post('/auth/logout'),

  getProfile: () => request.get('/auth/profile'),

  changePassword: (data: { oldPassword: string; newPassword: string }) =>
    request.put('/auth/password', data),
};
