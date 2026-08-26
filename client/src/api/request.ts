import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import i18n from '../i18n';
import { getMessage } from './message-holder';
import { useAuthStore } from '../stores/useAuthStore';

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

/** 刷新 token 的并发锁：多个请求同时过期时只真正刷新一次 */
let refreshing: Promise<boolean> | null = null;

const doRefresh = (): Promise<boolean> => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (!refreshToken) return false;
    try {
      const { data } = await axios.post('/api/auth/refresh', { refreshToken });
      const { accessToken, refreshToken: newRefresh, expiresIn } = data.data;
      useAuthStore.getState().setTokens(accessToken, newRefresh, expiresIn);
      return true;
    } catch {
      useAuthStore.getState().logout();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

/** accessToken 过期时静默刷新（不弹错误），返回刷新后的最新 accessToken */
const ensureValidToken = async (): Promise<string | null> => {
  const { accessToken, refreshToken, isTokenExpired } = useAuthStore.getState();
  if (accessToken && !isTokenExpired()) return accessToken;
  if (!refreshToken) return null;
  const ok = await doRefresh();
  return ok ? useAuthStore.getState().accessToken : null;
};

// 请求拦截器 - 携带 Token（发送前若已过期则先静默刷新）
request.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await ensureValidToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器 - 统一错误处理
request.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiResponse>) => {
    // 取消的请求（AbortController）不弹错误提示
    if (axios.isCancel(error)) {
      return Promise.reject(error);
    }
    // 登录接口的错误提示统一由登录页 catch 处理，拦截器不弹窗，避免重复提示
    if (error.config?.url?.includes('/auth/login')) {
      return Promise.reject(error);
    }
    if (error.response?.status === 401) {
      // 尝试用 refreshToken 刷新（兜底：前置拦截未覆盖到的场景）
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && error.config && !(error.config as unknown as Record<string, unknown>)._retry) {
        (error.config as unknown as Record<string, unknown>)._retry = true;
        const ok = await doRefresh();
        if (ok && error.config) {
          error.config.headers.Authorization = `Bearer ${useAuthStore.getState().accessToken}`;
          return request(error.config);
        }
        // refresh 也失败 → 跳转登录页
        localStorage.clear();
        window.location.href = '/login';
        return Promise.reject(error);
      }
      localStorage.clear();
      window.location.href = '/login';
    }
    // 429 限流：提示统一文案，不暴露后端原始 message
    if (error.response?.status === 429) {
      getMessage().error(i18n.t('error.tooManyRequests'));
      return Promise.reject(error);
    }
    const msg = error.response?.data?.message || i18n.t('error.networkError');
    getMessage().error(msg);
    return Promise.reject(error);
  },
);

export default request;

/** 上传图片文件，返回后端给出的访问 URL */
export async function uploadImage(file: Blob, filename = 'image.png'): Promise<string> {
  const form = new FormData();
  form.append('file', file, filename);
  const res = await request.post<ApiResponse<{ url: string; filename: string }>>('/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data.url;
}
