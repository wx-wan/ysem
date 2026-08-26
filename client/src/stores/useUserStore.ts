import { create } from 'zustand';
import { userApi, type UserSelectItem } from '../api/users';
import { useAuthStore } from './useAuthStore';

// 用户列表（用于负责人下拉、可见用户等）本地缓存
// 系统设置/用户类选项为低频数据，拉取一次后缓存，避免每次打开弹窗都实时请求后端。
const CACHE_KEY = 'ysem_user_select_options';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

interface UserCache {
  data: UserSelectItem[];
  savedAt: number;
}

function loadCache(): UserCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserCache;
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: UserSelectItem[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    /* 存储失败不影响使用 */
  }
}

interface UserState {
  users: UserSelectItem[];
  loading: boolean;
  /** 拉取用户下拉列表（带本地缓存：命中且未过期直接使用，否则请求后端并刷新缓存） */
  fetchUsers: () => Promise<UserSelectItem[]>;
  /** 取映射表 id -> 名称 */
  getNameMap: () => Record<string, string>;
  /**
   * 角色权限发生变化时触发：若当前登录用户属于该角色，弹出确认刷新提示（permChangedRoleId），
   * 由 MainLayout 用自定义 AppModal 渲染，避免 antd Modal 弃用警告。
   */
  permChangedRoleId: string | null;
  /** 收到权限变更通知 -> 设置待确认的 roleId（不属于当前用户则忽略） */
  notifyPermChanged: (roleId: string) => void;
  /** 关闭权限变更弹窗 */
  dismissPermChanged: () => void;
  /**
   * 确认刷新：当前登录用户属于该角色时刷新会话（user + permissions），使权限/数据范围即时生效。
   */
  reloadRoleUsers: (roleId: string) => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  loading: false,
  permChangedRoleId: null,

  notifyPermChanged: (roleId: string) => {
    const { user } = useAuthStore.getState();
    if (!user || user.role?.id !== roleId) return;
    set({ permChangedRoleId: roleId });
  },
  dismissPermChanged: () => set({ permChangedRoleId: null }),

  reloadRoleUsers: (roleId: string) => {
    const { user } = useAuthStore.getState();
    if (!user || user.role?.id !== roleId) return;
    // 当前登录用户属于该角色：静默刷新会话（使权限/数据范围即时生效）
    useAuthStore.getState().reloadUser();
  },

  fetchUsers: async () => {
    const cached = loadCache();
    // 缓存命中且未过期：直接采用，不请求后端
    if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
      set({ users: cached.data });
      return cached.data;
    }

    set({ loading: true });
    try {
      const res = await userApi.listForSelect();
      const data = res.data.data || [];
      saveCache(data);
      set({ users: data, loading: false });
      return data;
    } catch {
      // 请求失败：回退本地缓存（可能为空）
      if (cached) set({ users: cached.data });
      set({ loading: false });
      return cached?.data ?? [];
    }
  },

  getNameMap: () => {
    const m: Record<string, string> = {};
    get().users.forEach((u) => { m[u.id] = u.realName || u.username; });
    return m;
  },
}));
