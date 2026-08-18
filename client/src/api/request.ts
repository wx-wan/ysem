import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import i18n from '../i18n';
import { getMessage } from './message-holder';

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

const request = axios.create({
  baseURL: '/api',
  timeout: 10000,
});

// 请求拦截器 - 携带 Token
request.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('accessToken');
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
    if (error.response?.status === 401) {
      // 尝试用 refreshToken 刷新
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken && error.config && !(error.config as unknown as Record<string, unknown>)._retry) {
        (error.config as unknown as Record<string, unknown>)._retry = true;
        try {
          const { data } = await axios.post('/api/auth/refresh', { refreshToken });
          localStorage.setItem('accessToken', data.data.accessToken);
          localStorage.setItem('refreshToken', data.data.refreshToken);
          if (error.config) {
            error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
            return request(error.config);
          }
        } catch {
          localStorage.clear();
          window.location.href = '/login';
          return Promise.reject(error);
        }
      }
      localStorage.clear();
      window.location.href = '/login';
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
