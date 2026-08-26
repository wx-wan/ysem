import { create } from 'zustand';
import { userApi, type UserSelectItem } from '../api/users';

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
}

export const useUserStore = create<UserState>((set, get) => ({
  users: [],
  loading: false,

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
