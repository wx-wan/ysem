import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * 后端统一响应包装（Round F-0 §8）：
 *   · 成功：HTTP 200/201 · { code, message, data }
 *   · 失败：HTTP = code · { code, message }（无 data 字段）
 *   · 仅全局 errorHandler 的 ZodError 分支会额外给出 errors[]
 */
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
  errors?: { field: string; message: string }[];
}

/**
 * 唯一 HTTP 客户端。
 * 只负责：HTTP transport / Authorization / 401 拦截 / 单次 refresh / retry / 错误透传。
 * **不做响应解包**（调用方拿到 AxiosResponse<ApiResponse<T>>，自行读 response.data）。
 * token 不在此处硬编码，统一来自 auth store。
 */
const request = axios.create({
  baseURL: '/api',
  timeout: 15000,
});

// ========== 请求拦截器：自动附加 Authorization ==========
request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ========== 单 refresh 锁（F-1 §12）==========
// 并发多个 401 时共享同一个 refresh promise ⇒ 只触发一次 POST /api/auth/refresh。
let refreshing: Promise<boolean> | null = null;

const doRefresh = (): Promise<boolean> => {
  if (refreshing) return refreshing;

  refreshing = (async (): Promise<boolean> => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return false;
    try {
      // 使用裸 axios 调用 refresh，避免 refresh 请求本身再进入本拦截器造成递归
      const { data } = await axios.post<ApiResponse<{ accessToken: string; refreshToken: string; expiresIn: number }>>(
        '/api/auth/refresh',
        { refreshToken },
      );
      const payload = data?.data;
      if (!payload?.accessToken) return false;
      // refresh 响应不含 user/permissions（F-0 §4）⇒ 只更新 token，保留现有 user
      useAuthStore.getState().setTokens(payload.accessToken, payload.refreshToken, payload.expiresIn);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
};

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// ========== 响应拦截器：401 → refresh → retry（仅一次）==========
// 不做 data 解包，直接返回原始 AxiosResponse。
request.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError<ApiResponse>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';
    // 登录 / 刷新接口自身的 401 不参与 refresh-retry（避免 401→refresh→401 循环）
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (status === 401 && config && !config._retry && !isAuthEndpoint) {
      config._retry = true;
      const ok = await doRefresh();
      if (ok) {
        return request(config);
      }
      // refresh 失败：清理本地认证状态并跳转登录页（F-1 §13）
      useAuthStore.getState().clear();
      if (!window.location.pathname.startsWith('/login')) {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  },
);

/**
 * 安全提取错误信息（F-1 §17）：
 * 兼容 { message } / 网络错误 / 非 JSON 响应体，任何情况下都返回可展示字符串，不抛异常。
 */
/**
 * 安全提取 HTTP 状态码（F-7 additive）：
 * 用于页面区分 404（资源不存在 → Result）与其他失败（→ Alert 重新加载）。
 * 无法判定时返回 null —— 调用方**不得**把 null 当作 404。
 */
export const getErrorStatus = (error: unknown): number | null => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    return typeof status === 'number' ? status : null;
  }
  return null;
};

export const getErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const payload = error.response?.data as ApiResponse | undefined;
    if (payload && typeof payload.message === 'string' && payload.message) {
      return payload.message;
    }
    return error.message || 'Network Error';
  }
  if (error instanceof Error && error.message) return error.message;
  return '请求失败';
};

export default request;
