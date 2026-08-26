import { create } from 'zustand';
import { authApi } from '../api/auth';

interface UserInfo {
  id: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  avatar: string;
  role: { id: string; name: string; code: string } | null;
  departmentId: string;
  permissions?: string[];
}

const TOKEN_EXPIRES_KEY = 'tokenExpiresAt';
const USER_KEY = 'user';

interface AuthState {
  user: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** accessToken 过期时刻（毫秒时间戳），用于前端判断是否需要刷新 */
  tokenExpiresAt: number | null;
  isAuthenticated: boolean;
  /** 用户/权限信息是否已就绪（避免布局在 getProfile 返回前重渲染闪烁） */
  ready: boolean;
  permissions: string[];
  setAuth: (
    user: UserInfo,
    accessToken: string,
    refreshToken: string,
    expiresIn?: number,
  ) => void;
  /** 刷新后更新 token（不重设 user） */
  setTokens: (accessToken: string, refreshToken: string, expiresIn?: number) => void;
  /** 仅更新用户信息/权限（用于刷新页面后恢复 user，不触碰 token 与过期时间） */
  setUser: (user: UserInfo, permissions?: string[]) => void;
  /** 重新拉取当前登录用户的资料与权限（权限/角色变更后即时生效） */
  reloadUser: () => void;
  /** accessToken 是否已过期（或即将过期） */
  isTokenExpired: () => boolean;
  setPermissions: (permissions: string[]) => void;
  setReady: (ready: boolean) => void;
  logout: () => void;
  restoreAuth: () => void;
}

/** 计算过期时刻：expiresIn 为秒；留出 30s 缓冲，避免临界请求失败 */
const computeExpiresAt = (expiresIn?: number): number | null => {
  if (!expiresIn) return null;
  const buffer = Math.min(30, Math.floor(expiresIn / 2));
  return Date.now() + (expiresIn - buffer) * 1000;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  tokenExpiresAt: Number(localStorage.getItem(TOKEN_EXPIRES_KEY)) || null,
  isAuthenticated: !!localStorage.getItem('accessToken'),
  ready: !!localStorage.getItem('user'),
  permissions: JSON.parse(localStorage.getItem('permissions') || '[]'),

  setAuth: (user, accessToken, refreshToken, expiresIn) => {
    const permissions = user.permissions ?? [];
    const expiresAt = computeExpiresAt(expiresIn);
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    localStorage.setItem('permissions', JSON.stringify(permissions));
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    if (expiresAt) localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
    else localStorage.removeItem(TOKEN_EXPIRES_KEY);
    set({ user, accessToken, refreshToken, tokenExpiresAt: expiresAt, permissions, isAuthenticated: true, ready: true });
  },

  setUser: (user, permissions) => {
    const perms = permissions ?? user.permissions ?? [];
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem('permissions', JSON.stringify(perms));
    set({ user, permissions: perms, ready: true });
  },

  reloadUser: async () => {
    try {
      const res: any = await authApi.getProfile();
      const { permissions } = res.data.data;
      const perms = Array.isArray(permissions) ? permissions : [];
      useAuthStore.getState().setUser(res.data.data, perms);
    } catch {
      /* 刷新失败不影响当前会话 */
    }
  },

  setTokens: (accessToken, refreshToken, expiresIn) => {
    const expiresAt = computeExpiresAt(expiresIn);
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    if (expiresAt) localStorage.setItem(TOKEN_EXPIRES_KEY, String(expiresAt));
    else localStorage.removeItem(TOKEN_EXPIRES_KEY);
    set({ accessToken, refreshToken, tokenExpiresAt: expiresAt });
  },

  isTokenExpired: () => {
    const expiresAt = get().tokenExpiresAt;
    if (!expiresAt) return false; // 未知过期时间时交给后端 401 处理
    return Date.now() >= expiresAt;
  },

  setPermissions: (permissions) => {
    localStorage.setItem('permissions', JSON.stringify(permissions));
    set({ permissions });
  },

  setReady: (ready) => set({ ready }),

  logout: () => {
    localStorage.clear();
    set({ user: null, accessToken: null, refreshToken: null, tokenExpiresAt: null, permissions: [], isAuthenticated: false, ready: false });
  },

  restoreAuth: () => {
    const token = localStorage.getItem('accessToken');
    const permissions = JSON.parse(localStorage.getItem('permissions') || '[]');
    const userRaw = localStorage.getItem(USER_KEY);
    const user = userRaw ? (JSON.parse(userRaw) as UserInfo) : null;
    set({
      user,
      accessToken: token,
      permissions,
      tokenExpiresAt: Number(localStorage.getItem(TOKEN_EXPIRES_KEY)) || null,
      isAuthenticated: !!token,
      ready: !!user,
    });
  },
}));
