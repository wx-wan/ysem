import { create } from 'zustand';
import * as api from '../api/masterData';
import { getErrorMessage } from '../api/request';
import type {
  Certificate,
  Channel,
  Country,
  CustomerType,
  ProductAudience,
  ProductCategory,
  ProductCraft,
  ProductOption,
} from '../types/masterData';

/**
 * Shared Master Data Store（Round F-4 §17-§20）
 *
 * 设计要点：
 *   · 单一 store 承载全部字典数据（不为每种数据建独立 store）；
 *   · 每个数据集持有 { data, loading, error, loadedAt }；
 *   · **TTL 缓存**：TTL 内重复请求直接命中缓存，不再发网络请求；并发调用共享同一个 in-flight promise；
 *   · **会话安全**：记录 `sessionUserId`，认证用户变化时整体清空，避免跨用户残留；
 *   · 不保存任何 token / CurrentUser 副本。
 *
 * 不缓存：customerOptions（F-4A 判定为 page-level，且本轮不实现该数据集）。
 * 不纳入 store：userSelectOptions（F-01 禁止其作为 owner 候选源，非字典用途）。
 */

/** 统一 TTL：10 分钟（低频字典数据） */
export const MASTER_DATA_TTL_MS = 10 * 60 * 1000;

/** 各数据集的数据类型映射 */
export interface MasterDataValues {
  customerTypes: CustomerType[];
  channels: Channel[];
  countries: Country[];
  certificates: Certificate[];
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  categories: ProductCategory[];
  productOptions: ProductOption[];
}

export type MasterDataKey = keyof MasterDataValues;

export interface DatasetState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** 最近一次成功加载时刻（毫秒）；null = 从未成功加载 */
  loadedAt: number | null;
}

interface LoadOptions {
  /** true = 跳过 TTL 缓存，强制重新请求 */
  force?: boolean;
}

export interface MasterDataState {
  /** 缓存归属的认证用户 id（用于会话切换时清空；不保存 token / user 副本） */
  sessionUserId: string | null;

  customerTypes: DatasetState<CustomerType[]>;
  channels: DatasetState<Channel[]>;
  countries: DatasetState<Country[]>;
  certificates: DatasetState<Certificate[]>;
  crafts: DatasetState<ProductCraft[]>;
  audiences: DatasetState<ProductAudience[]>;
  categories: DatasetState<ProductCategory[]>;
  productOptions: DatasetState<ProductOption[]>;

  loadCustomerTypes: (options?: LoadOptions) => Promise<CustomerType[]>;
  loadChannels: (options?: LoadOptions) => Promise<Channel[]>;
  loadCountries: (options?: LoadOptions) => Promise<Country[]>;
  loadCertificates: (options?: LoadOptions) => Promise<Certificate[]>;
  /** 一次加载 crafts + audiences + categories（三者为同一域，通常同时需要） */
  loadProductTaxonomy: (options?: LoadOptions) => Promise<void>;
  loadProductOptions: (options?: LoadOptions) => Promise<ProductOption[]>;
  /** 加载全部（并发；各自遵守 TTL 与 in-flight 去重） */
  loadAll: (options?: LoadOptions) => Promise<void>;

  /** 强制刷新单个数据集 */
  refresh: (key: MasterDataKey) => Promise<void>;
  /** 强制刷新全部数据集 */
  refreshAll: () => Promise<void>;

  /** 清空全部缓存数据（保留 sessionUserId，仅丢弃数据） */
  clear: () => void;
  /** 会话安全：认证用户变化 ⇒ 清空缓存并记录新的 sessionUserId */
  ensureSession: (userId: string | null) => void;
}

const emptyDataset = <T>(): DatasetState<T> => ({ data: null, loading: false, error: null, loadedAt: null });

const emptyDatasets = () => ({
  customerTypes: emptyDataset<CustomerType[]>(),
  channels: emptyDataset<Channel[]>(),
  countries: emptyDataset<Country[]>(),
  certificates: emptyDataset<Certificate[]>(),
  crafts: emptyDataset<ProductCraft[]>(),
  audiences: emptyDataset<ProductAudience[]>(),
  categories: emptyDataset<ProductCategory[]>(),
  productOptions: emptyDataset<ProductOption[]>(),
});

/** 各数据集的真实取数函数（单一事实来源，供 load / refresh 复用） */
const FETCHERS: { [K in MasterDataKey]: () => Promise<MasterDataValues[K]> } = {
  customerTypes: api.getCustomerTypes,
  channels: api.getChannelsTree,
  countries: api.getCountries,
  certificates: api.getCertificates,
  crafts: api.getProductCrafts,
  audiences: api.getProductAudiences,
  categories: api.getProductCategories,
  productOptions: api.getProductOptions,
};

export const MASTER_DATA_KEYS = Object.keys(FETCHERS) as MasterDataKey[];

export const useMasterDataStore = create<MasterDataState>((set, get) => {
  /** in-flight 去重（并发调用共享同一 promise，避免重复网络请求） */
  const inFlight = new Map<MasterDataKey, Promise<unknown>>();

  /**
   * 通用加载：TTL 命中直接返回缓存 → in-flight 命中复用 → 否则发起请求并落库。
   * 注意：动态 key 写入 zustand 需要断言；类型安全由本函数的泛型 K 保证（key ↔ 数据类型一一对应）。
   */
  const load = async <K extends MasterDataKey>(
    key: K,
    fetcher: () => Promise<MasterDataValues[K]>,
    force = false,
  ): Promise<MasterDataValues[K]> => {
    const state = get() as unknown as Record<MasterDataKey, DatasetState<MasterDataValues[K]>>;
    const current = state[key];

    if (!force) {
      const isFresh =
        current.data !== null &&
        current.loadedAt !== null &&
        Date.now() - current.loadedAt < MASTER_DATA_TTL_MS;
      if (isFresh) return current.data as MasterDataValues[K];

      const pending = inFlight.get(key);
      if (pending) return pending as Promise<MasterDataValues[K]>;
    }

    const task = (async (): Promise<MasterDataValues[K]> => {
      const patch = (value: Partial<DatasetState<MasterDataValues[K]>>) =>
        set(() => ({ [key]: { ...(get() as unknown as Record<string, DatasetState<unknown>>)[key], ...value } }) as Partial<MasterDataState>);

      patch({ loading: true, error: null });
      try {
        const data = await fetcher();
        set(() => ({ [key]: { data, loading: false, error: null, loadedAt: Date.now() } }) as Partial<MasterDataState>);
        return data;
      } catch (err) {
        patch({ loading: false, error: getErrorMessage(err) });
        throw err;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, task);
    return task;
  };

  const refreshKey = async (key: MasterDataKey): Promise<void> => {
    await load(key, FETCHERS[key], true);
  };

  return {
    sessionUserId: null,
    ...emptyDatasets(),

    loadCustomerTypes: (options) => load('customerTypes', FETCHERS.customerTypes, options?.force),
    loadChannels: (options) => load('channels', FETCHERS.channels, options?.force),
    loadCountries: (options) => load('countries', FETCHERS.countries, options?.force),
    loadCertificates: (options) => load('certificates', FETCHERS.certificates, options?.force),

    loadProductTaxonomy: async (options) => {
      await Promise.all([
        load('crafts', FETCHERS.crafts, options?.force),
        load('audiences', FETCHERS.audiences, options?.force),
        load('categories', FETCHERS.categories, options?.force),
      ]);
    },

    loadProductOptions: (options) => load('productOptions', FETCHERS.productOptions, options?.force),

    loadAll: async (options) => {
      await Promise.all([
        load('customerTypes', FETCHERS.customerTypes, options?.force),
        load('channels', FETCHERS.channels, options?.force),
        load('countries', FETCHERS.countries, options?.force),
        load('certificates', FETCHERS.certificates, options?.force),
        load('crafts', FETCHERS.crafts, options?.force),
        load('audiences', FETCHERS.audiences, options?.force),
        load('categories', FETCHERS.categories, options?.force),
        load('productOptions', FETCHERS.productOptions, options?.force),
      ]);
    },

    refresh: refreshKey,
    refreshAll: async () => {
      await Promise.all(MASTER_DATA_KEYS.map((key) => load(key, FETCHERS[key], true)));
    },

    clear: () => set(() => ({ ...emptyDatasets() })),

    ensureSession: (userId) => {
      if (get().sessionUserId === userId) return;
      // 用户变化（含登出 → null）：丢弃全部缓存，避免跨会话残留
      set(() => ({ ...emptyDatasets(), sessionUserId: userId }));
    },
  };
});
