import { create } from 'zustand';
import { authApi } from '../api/auth';
import type { CurrentUser } from '../types/auth';

/** localStorage key（新前端独立命名空间，不与旧 client 共享） */
const KEYS = {
  access: 'ysem.accessToken',
  refresh: 'ysem.refreshToken',
  expiresAt: 'ysem.tokenExpiresAt',
} as const;

/** 计算 token 过期时刻（毫秒）；expiresIn 为秒 */
const computeExpiresAt = (expiresIn?: number): number | null =>
  expiresIn && expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

const readNumber = (key: string): number | null => {
  const raw = localStorage.getItem(key);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  /** accessToken 过期时刻（毫秒时间戳） */
  tokenExpiresAt: number | null;
  /** Current User：只来自 GET /api/auth/profile */
  user: CurrentUser | null;
  /** 启动恢复是否完成（未完成前路由不跳登录页） */
  ready: boolean;
  isAuthenticated: boolean;

  /** 登录成功：写入 token 会话 */
  setSession: (accessToken: string, refreshToken: string, expiresIn?: number) => void;
  /** 仅更新 token（refresh 场景，保留现有 user） */
  setTokens: (accessToken: string, refreshToken: string, expiresIn?: number) => void;
  /** 写入 profile 结果 */
  setUser: (user: CurrentUser) => void;
  /** 清空本地认证状态（token + user） */
  clear: () => void;
  /** 应用启动时恢复认证状态（F-1 §15） */
  initialize: () => Promise<void>;
  /** 登出：先尝试通知后端，无论成败都清理本地并交由路由守卫跳转 */
  logout: () => Promise<void>;
}

/** 防止 React StrictMode 双执行 / 重复调用导致多次 profile 请求 */
let initializing = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: localStorage.getItem(KEYS.access),
  refreshToken: localStorage.getItem(KEYS.refresh),
  tokenExpiresAt: readNumber(KEYS.expiresAt),
  user: null,
  ready: false,
  isAuthenticated: false,

  setSession: (accessToken, refreshToken, expiresIn) => {
    const tokenExpiresAt = computeExpiresAt(expiresIn);
    localStorage.setItem(KEYS.access, accessToken);
    localStorage.setItem(KEYS.refresh, refreshToken);
    if (tokenExpiresAt) localStorage.setItem(KEYS.expiresAt, String(tokenExpiresAt));
    set({ accessToken, refreshToken, tokenExpiresAt, isAuthenticated: true });
  },

  setTokens: (accessToken, refreshToken, expiresIn) => {
    const tokenExpiresAt = computeExpiresAt(expiresIn);
    localStorage.setItem(KEYS.access, accessToken);
    localStorage.setItem(KEYS.refresh, refreshToken);
    if (tokenExpiresAt) localStorage.setItem(KEYS.expiresAt, String(tokenExpiresAt));
    // 保留现有 user（refresh 响应不含 user/permissions）
    set({ accessToken, refreshToken, tokenExpiresAt, isAuthenticated: true });
  },

  setUser: (user) => set({ user }),

  clear: () => {
    localStorage.removeItem(KEYS.access);
    localStorage.removeItem(KEYS.refresh);
    localStorage.removeItem(KEYS.expiresAt);
    set({
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      user: null,
      isAuthenticated: false,
      ready: true,
    });
  },

  initialize: async () => {
    if (get().ready || initializing) return;
    initializing = true;

    const accessToken = localStorage.getItem(KEYS.access);
    const refreshToken = localStorage.getItem(KEYS.refresh);

    if (!accessToken) {
      // 无 token：无需请求后端
      set({ accessToken: null, refreshToken, tokenExpiresAt: null, ready: true, isAuthenticated: false });
      initializing = false;
      return;
    }

    set({ accessToken, refreshToken, tokenExpiresAt: readNumber(KEYS.expiresAt) });

    try {
      // 401 时由 request 拦截器自动 refresh + retry（只一次）
      const res = await authApi.profile();
      set({ user: res.data.data, ready: true, isAuthenticated: true });
    } catch {
      // 最终失败（含 refresh 失败）：清理本地状态；路由守卫会跳 /login
      get().clear();
    } finally {
      initializing = false;
    }
  },

  logout: async () => {
    const { refreshToken } = get();
    try {
      // 优先携带 refreshToken（仅登出当前端）
      await authApi.logout(refreshToken ? { refreshToken } : undefined);
    } catch {
      // 后端失败也必须允许本地退出（F-1 §14）
    }
    get().clear();
  },
}));
