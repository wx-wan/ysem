import { useEffect } from 'react';
import { create } from 'zustand';
import commToolApi from '../api/commTool';

interface CommToolItem {
  name: string;
  id: string;
  icon?: string | null;
}

interface CommToolState {
  tools: CommToolItem[];
  loading: boolean;
  /**
   * 取启用的沟通工具（下拉用）。
   * - 内存态为会话内唯一数据源，避免 localStorage 缓存导致的陈旧下拉（曾出现过只显示旧 2 条的问题）。
   * - 非强制时：若本次会话已加载过则直接复用（避免重复请求）；首次或强制刷新才请求后端。
   */
  fetchTools: (force?: boolean) => Promise<CommToolItem[]>;
  /** 系统设置 → 沟通工具维护 发生增删/启停/排序后调用，立即重新拉取令所有下拉即时生效 */
  invalidate: () => Promise<CommToolItem[]>;
}

export const useCommToolStore = create<CommToolState>((set, get) => ({
  tools: [],
  loading: false,

  fetchTools: async (force = false) => {
    if (!force && get().tools.length > 0) return get().tools;
    set({ loading: true });
    try {
      const res = await commToolApi.getActive();
      const data = res.data.data || [];
      set({ tools: data, loading: false });
      return data;
    } catch {
      set({ loading: false });
      return get().tools;
    }
  },

  invalidate: async () => get().fetchTools(true),
}));

// 方便组件直接拿 options 的 hook
export function useCommToolOptions() {
  const tools = useCommToolStore((s) => s.tools);
  const loading = useCommToolStore((s) => s.loading);
  const fetchTools = useCommToolStore((s) => s.fetchTools);
  // 挂载即拉取（内存态为空 → 请求后端拿到最新全量，避免陈旧下拉）
  useEffect(() => {
    fetchTools();
  }, [fetchTools]);
  return {
    options: tools.map((item) => ({ label: item.name, value: item.name })),
    loading,
    fetchTools,
  };
}
