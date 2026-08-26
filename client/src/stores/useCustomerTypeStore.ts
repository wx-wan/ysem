import { create } from 'zustand';
import customerTypeApi from '../api/customerType';

// 客户类型下拉（系统设置类低频数据）本地缓存，避免每次渲染都实时请求后端
const CACHE_KEY = 'ysem_customer_type_options';
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

interface CustomerTypeState {
  types: { name: string; id: string }[];
  loading: boolean;
  fetchTypes: () => Promise<{ name: string; id: string }[]>;
}

export const useCustomerTypeStore = create<CustomerTypeState>((set, get) => ({
  types: [],
  loading: false,

  fetchTypes: async () => {
    const cached = loadCache();
    if (cached && Date.now() - cached.savedAt < CACHE_TTL) {
      set({ types: cached.data });
      return cached.data;
    }
    set({ loading: true });
    try {
      const res = await customerTypeApi.getActive();
      const data = res.data.data || [];
      saveCache(data);
      set({ types: data, loading: false });
      return data;
    } catch {
      if (cached) set({ types: cached.data });
      set({ loading: false });
      return cached?.data ?? [];
    }
  },
}));

// 方便组件直接拿 options 的 hook
export function useCustomerTypeOptions() {
  const types = useCustomerTypeStore((s) => s.types);
  const fetchTypes = useCustomerTypeStore((s) => s.fetchTypes);
  return {
    options: types.map((item) => ({ label: item.name, value: item.name })),
    loading: useCustomerTypeStore((s) => s.loading),
    fetchTypes,
  };
}
