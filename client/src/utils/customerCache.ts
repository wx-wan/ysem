import type { Customer } from '../api/customers';
import { customerApi } from '../api/customers';

/**
 * 前端缓存：列表与单个客户详情。
 * 目的：在当前视图内复用数据、减少重复请求，并在数据未变化时跳过 state 更新（配合 diff 工具）。
 *
 * 失效策略（非时间驱动）：
 *   - 视图内：缓存长期有效，不再因时间过期强制回源；列表/详情以 React state 为实时源。
 *   - 离开视图：当用户切换标签页（document.hidden）、页面隐藏（pagehide）或关闭（beforeunload）
 *     时统一清空缓存，下次进入视图即重新拉取最新数据。
 *   - 显式变更（增删改/导入/转交等）调用 invalidateAll() 立即失效，保证写后回源。
 *
 * 均为内存缓存，刷新页面即自然失效，不做持久化。
 */

export interface ListCacheEntry {
  list: Customer[];
  total: number;
  estimatedAmount: number;
  totalContractAmount: number;
  estimatedBreakdown: any[];
  contractBreakdown: any[];
}

const listCache = new Map<string, ListCacheEntry>();
const detailCache = new Map<string, Customer>();

/** 缓存版本号：数据结构变更时递增，使旧缓存自动失效 */
const CACHE_VERSION = 'v2';

/** 把查询参数序列化为稳定签名（过滤 undefined / 排序键名） */
export function listCacheKey(params: Record<string, any>): string {
  return CACHE_VERSION + '|' + Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
}

export function getListCache(key: string): ListCacheEntry | null {
  return listCache.get(key) ?? null;
}

export function setListCache(key: string, entry: ListCacheEntry): void {
  listCache.set(key, entry);
}

export function getDetailCache(id: string): Customer | null {
  return detailCache.get(id) ?? null;
}

export function setDetailCache(customer: Customer): void {
  detailCache.set(customer.id, customer);
}

export function invalidateDetail(id: string): void {
  detailCache.delete(id);
}

export function invalidateAll(): void {
  listCache.clear();
  detailCache.clear();
}

/**
 * 注册「离开视图」失效：在标签页隐藏 / 页面卸载时清空缓存。
 * 仅在 document.hidden 时触发（切走才失效，切回不失效）。
 * 幂等：多次调用不会重复绑定。
 */
let lifecycleInstalled = false;
export function installCacheLifecycle(): void {
  if (lifecycleInstalled || typeof window === 'undefined') return;
  lifecycleInstalled = true;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) invalidateAll();
  });
  // 移动端/页面切换
  window.addEventListener('pagehide', invalidateAll);
  // 关闭/刷新（部分浏览器在 unload 阶段仍可执行）
  window.addEventListener('beforeunload', invalidateAll);
}

/**
 * 拉取单个客户详情：优先命中缓存，未命中再请求。
 * 同时用 setDetailCache 回填缓存，供后续编辑回显复用。
 * @param force 为 true 时跳过缓存、强制回源（如详情弹窗「刷新」按钮）
 */
export async function fetchCustomerDetail(id: string, force = false): Promise<Customer> {
  if (!force) {
    const cached = getDetailCache(id);
    if (cached) return cached;
  }
  const res = await customerApi.getById(id);
  const data = res.data.data;
  setDetailCache(data);
  return data;
}
