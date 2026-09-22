import { useEffect, useMemo } from 'react';
import { useCurrentUser } from '../auth/useCurrentUser';
import {
  MASTER_DATA_KEYS,
  useMasterDataStore,
  type DatasetState,
  type MasterDataKey,
} from '../stores/useMasterDataStore';
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
import { filterActiveChannels } from '../utils/masterData';

export interface MasterDataStatus {
  loading: boolean;
  error: string | null;
  loadedAt: number | null;
}

export interface UseMasterDataResult {
  customerTypes: CustomerType[];
  /** 原始渠道树（含 INACTIVE 节点） */
  channels: Channel[];
  /** 已按 ACTIVE 过滤、可供选择的渠道树（纯派生；父级 INACTIVE 的整枝不出现） */
  activeChannels: Channel[];
  countries: Country[];
  certificates: Certificate[];
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  categories: ProductCategory[];
  productOptions: ProductOption[];

  /** 任一数据集正在加载 */
  loading: boolean;
  /** 任一数据集最近一次错误（有值即表示上层应提示） */
  error: string | null;
  /** 各数据集细粒度状态 */
  status: Record<MasterDataKey, MasterDataStatus>;
  /** 缓存归属的认证用户 id */
  sessionUserId: string | null;

  loadAll: (options?: { force?: boolean }) => Promise<void>;
  loadProductTaxonomy: (options?: { force?: boolean }) => Promise<void>;
  /** 单数据集加载器（F-6 additive：页面按需加载所消费的字典，避免整包拉取） */
  loadCustomerTypes: (options?: { force?: boolean }) => Promise<CustomerType[]>;
  loadChannels: (options?: { force?: boolean }) => Promise<Channel[]>;
  loadCountries: (options?: { force?: boolean }) => Promise<Country[]>;
  loadCertificates: (options?: { force?: boolean }) => Promise<Certificate[]>;
  loadProductOptions: (options?: { force?: boolean }) => Promise<ProductOption[]>;
  refresh: (key: MasterDataKey) => Promise<void>;
  refreshAll: () => Promise<void>;
  clear: () => void;
}

const EMPTY_STATUS: MasterDataStatus = { loading: false, error: null, loadedAt: null };

const toStatus = (dataset: DatasetState<unknown>): MasterDataStatus => ({
  loading: dataset.loading,
  error: dataset.error,
  loadedAt: dataset.loadedAt,
});

/**
 * 页面消费入口（Round F-4 §21）
 *
 * 页面只依赖本 hook，不直接操作 store 内部字段。
 * 职责：
 *   · 会话安全：CurrentUser 变化时自动 ensureSession（清空上一用户缓存）；
 *   · 只读投影：data 缺省为 []，避免页面到处做 null 判断；
 *   · 派生 activeChannels（ACTIVE 过滤），页面无需自行处理渠道停用语义；
 *   · 暴露 loadAll / refresh / refreshAll / clear。
 *
 * 本 hook **不自动加载**数据（由页面决定加载时机），但会自动维护会话边界。
 */
export function useMasterData(): UseMasterDataResult {
  const { user } = useCurrentUser();
  const store = useMasterDataStore();

  const userId = user?.id ?? null;
  const ensureSession = store.ensureSession;

  // 会话安全：登录用户变化（含登出）⇒ 清空上一会话的主数据缓存
  useEffect(() => {
    ensureSession(userId);
  }, [ensureSession, userId]);

  const activeChannels = useMemo(() => filterActiveChannels(store.channels.data ?? []), [store.channels.data]);

  const status = useMemo(
    () =>
      MASTER_DATA_KEYS.reduce((acc, key) => {
        acc[key] = toStatus(store[key]);
        return acc;
      }, {} as Record<MasterDataKey, MasterDataStatus>),
    [store],
  );

  const loading = useMemo(() => MASTER_DATA_KEYS.some((key) => status[key].loading), [status]);
  const error = useMemo(() => {
    const first = MASTER_DATA_KEYS.find((key) => status[key].error);
    return first ? status[first].error : null;
  }, [status]);

  return {
    customerTypes: store.customerTypes.data ?? [],
    channels: store.channels.data ?? [],
    activeChannels,
    countries: store.countries.data ?? [],
    certificates: store.certificates.data ?? [],
    crafts: store.crafts.data ?? [],
    audiences: store.audiences.data ?? [],
    categories: store.categories.data ?? [],
    productOptions: store.productOptions.data ?? [],

    loading,
    error,
    status,
    sessionUserId: store.sessionUserId,

    loadAll: store.loadAll,
    loadProductTaxonomy: store.loadProductTaxonomy,
    loadCustomerTypes: store.loadCustomerTypes,
    loadChannels: store.loadChannels,
    loadCountries: store.loadCountries,
    loadCertificates: store.loadCertificates,
    loadProductOptions: store.loadProductOptions,
    refresh: store.refresh,
    refreshAll: store.refreshAll,
    clear: store.clear,
  };
}

/** 细粒度状态默认值（供未挂载 hook 的场景读取） */
export const EMPTY_MASTER_DATA_STATUS = EMPTY_STATUS;

export default useMasterData;
