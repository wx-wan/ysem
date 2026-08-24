import type { Product, MixedItem } from '../api/products';
import { productApi } from '../api/products';

/**
 * 前端缓存：产品列表与单个产品详情。
 * 逻辑与客户模块保持一致：
 *   - 视图内复用数据、减少重复请求；
 *   - 离开视图（切走标签页/页面卸载）时统一清空，下次进入回源；
 *   - 增删改后显式 invalidateAll() 立即失效，保证写后回源。
 * 均为内存缓存，刷新页面即自然失效，不做持久化。
 */

export interface ListCacheEntry {
  list: MixedItem[];
  total: number;
}

const listCache = new Map<string, ListCacheEntry>();
const detailCache = new Map<string, Product>();

/** 缓存版本号：数据结构变更时递增，使旧缓存自动失效 */
const CACHE_VERSION = 'v1';

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

export function getDetailCache(id: string): Product | null {
  return detailCache.get(id) ?? null;
}

export function setDetailCache(product: Product): void {
  detailCache.set(product.id, product);
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
  window.addEventListener('pagehide', invalidateAll);
  window.addEventListener('beforeunload', invalidateAll);
}

/**
 * 拉取单个产品详情：优先命中缓存，未命中再请求。
 * @param force 为 true 时跳过缓存、强制回源。
 */
export async function fetchProductDetail(id: string, force = false): Promise<Product> {
  if (!force) {
    const cached = getDetailCache(id);
    if (cached) return cached;
  }
  const res = await productApi.getById(id);
  const data = res.data;
  setDetailCache(data);
  return data;
}
