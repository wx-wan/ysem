import request, { type ApiResponse } from './request';
import type {
  ChangePasswordRequest,
  CurrentUser,
  LoginRequest,
  LoginResponse,
  LogoutRequest,
  RefreshRequest,
  RefreshResponse,
} from '../types/auth';

/**
 * 认证 API —— 只包含后端**实际存在**的接口（Round F-0 §4）：
 *   POST /api/auth/login     POST /api/auth/refresh
 *   GET  /api/auth/profile   POST /api/auth/logout
 *   PUT  /api/auth/password
 *
 * 返回值为原始 AxiosResponse<ApiResponse<T>>：调用方读 `res.data`（ApiResponse），
 * 业务数据在 `res.data.data`（本层不做解包）。
 */
export const authApi = {
  /** 登录：成功 data = { accessToken, refreshToken, expiresIn, user } */
  login: (payload: LoginRequest) => request.post<ApiResponse<LoginResponse>>('/auth/login', payload),

  /** 刷新：成功 data = { accessToken, refreshToken, expiresIn }（不含 user） */
  refresh: (payload: RefreshRequest) => request.post<ApiResponse<RefreshResponse>>('/auth/refresh', payload),

  /** 当前用户：data = CurrentUser（前端 Current User 唯一权威来源） */
  profile: () => request.get<ApiResponse<CurrentUser>>('/auth/profile'),

  /** 登出：可选携带 refreshToken（只登出该端）；不传则清空全部 refreshTokens */
  logout: (payload?: LogoutRequest) => request.post<ApiResponse<null>>('/auth/logout', payload ?? {}),

  /** 修改密码：成功后服务端会清空 refreshTokens（需重新登录） */
  changePassword: (payload: ChangePasswordRequest) => request.put<ApiResponse<null>>('/auth/password', payload),
};

export default authApi;
