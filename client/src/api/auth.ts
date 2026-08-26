import request from './request';

export interface LoginParams {
  username: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  /** accessToken 有效期（秒），由后端 JWT_EXPIRES_IN 决定 */
  expiresIn: number;
  user: {
    id: string;
    username: string;
    realName: string;
    email: string;
    phone: string;
    avatar: string;
    role: { id: string; name: string; code: string } | null;
    departmentId: string;
    permissions?: string[];
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
