import { create } from 'zustand';
import commToolApi from '../api/commTool';

// 沟通工具下拉（系统设置类低频数据）本地缓存，避免每次渲染都实时请求后端
const CACHE_KEY = 'ysem_comm_tool_options';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

interface CacheShape {
  data: { name: string; id: string }[];
  savedAt: number;
}

function loadCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || !Array.isArray(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(data: CacheShape['data']) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
}

interface CommToolState {
  tools: { name: string; id: string }[];
  loading: boolean;
  fetchTools: () => Promise<{ name: string; id: string }[]>;
  /**
   * 主数据被改动后调用（系统设置 → 沟通工具维护 的新增/编辑/删除/启停/排序）：
   * 清掉本地缓存并**立即**重新拉取，令所有下拉组件即时生效。
   */
  invalidate: () => Promise<{ name: string; id: string }[]>;
}

export const useCommToolStore = create<CommToolState>((set, get) => ({
  tools: [],
  loading: false,

  fetchTools: async () => {
    const cached = loadCache();
    if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
      set({ tools: cached.data });
      return cached.data;
    }
    set({ loading: true });
    try {
      const res = await commToolApi.getActive();
      const data = res.data.data || [];
      saveCache(data);
      set({ tools: data, loading: false });
      return data;
    } catch {
      if (cached) set({ tools: cached.data });
      set({ loading: false });
      return cached?.data ?? [];
    }
  },

  invalidate: async () => {
    clearCache();
    return get().fetchTools();
  },
}));

// 方便组件直接拿 options 的 hook
export function useCommToolOptions() {
  const tools = useCommToolStore((s) => s.tools);
  const fetchTools = useCommToolStore((s) => s.fetchTools);
  return {
    options: tools.map((item) => ({ label: item.name, value: item.name })),
    loading: useCommToolStore((s) => s.loading),
    fetchTools,
  };
}
