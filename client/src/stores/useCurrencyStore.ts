import { create } from 'zustand';
import axios from 'axios';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  label: string;
  labelZh: string;
}

// 支持币种列表
export const CURRENCIES: CurrencyInfo[] = [
  { code: 'CNY', symbol: '¥', label: 'CNY', labelZh: '人民币' },
  { code: 'USD', symbol: '$', label: 'USD', labelZh: '美元' },
  { code: 'EUR', symbol: '€', label: 'EUR', labelZh: '欧元' },
  { code: 'GBP', symbol: '£', label: 'GBP', labelZh: '英镑' },
  { code: 'JPY', symbol: '¥', label: 'JPY', labelZh: '日元' },
  { code: 'KRW', symbol: '₩', label: 'KRW', labelZh: '韩元' },
];

interface CurrencyState {
  // 当前选中币种
  currency: CurrencyInfo;
  // 汇率表（rateToCny 语义）: { USD: 7.25, EUR: 7.89, ... }，即 1 单位该币种 = X CNY
  rates: Record<string, number>;
  // 加载状态
  loading: boolean;
  // 上次更新时间
  lastUpdated: string | null;

  setCurrency: (code: string) => void;
  fetchRates: () => Promise<void>;
  // 转换金额（CNY → 当前币种）
  convert: (amountCNY: number) => number;
  // 格式化金额
  format: (amountCNY: number) => string;
  // 获取当前币种兑 CNY 的汇率展示文本
  getRateToCNY: () => string | null;
}

const STORAGE_KEY = 'ysem_currency';
const RATES_CACHE_KEY = 'ysem_exchange_rates';

/** 后端汇率语义标记：rates[X] 表示 1 单位 X = rates[X] CNY（V1.0 rateToCny） */
const RATE_TYPE_RATE_TO_CNY = 'rateToCny';

// 汇率本地缓存结构（按日期缓存，当天不再向后端请求）
interface RatesCache {
  date: string; // 汇率对应日期 YYYY-MM-DD
  rates: Record<string, number>;
  savedAt: string; // ISO 时间戳
}

// 从 localStorage 恢复或默认 CNY
function loadSavedCurrency(): CurrencyInfo {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const found = CURRENCIES.find((c) => c.code === saved);
      if (found) return found;
    }
  } catch {}
  return CURRENCIES[0]; // 默认 CNY
}

function loadRatesCache(): RatesCache | null {
  try {
    const raw = localStorage.getItem(RATES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RatesCache;
    if (!parsed || !parsed.date || typeof parsed.rates !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRatesCache(cache: RatesCache) {
  try {
    localStorage.setItem(RATES_CACHE_KEY, JSON.stringify(cache));
  } catch { /* 存储失败不影响使用 */ }
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency: loadSavedCurrency(),
  rates: {},
  loading: false,
  lastUpdated: null,

  setCurrency: (code: string) => {
    const found = CURRENCIES.find((c) => c.code === code);
    if (found) {
      localStorage.setItem(STORAGE_KEY, code);
      set({ currency: found });
    }
  },

  fetchRates: async () => {
    // 1. 本地缓存命中（当天已拉取过）：直接使用，不再请求后端。
    //    用 savedAt 判断而非 date：外部源失败时后端会回退最近一次历史汇率，
    //    date 是旧日期，若按 date === today 判断会永不命中、反复请求。
    const cached = loadRatesCache();
    const today = new Date().toISOString().slice(0, 10);
    if (cached && cached.savedAt.slice(0, 10) === today) {
      set({ rates: cached.rates, loading: false, lastUpdated: cached.savedAt });
      return;
    }

    // 2. 未命中：请求后端（后端自身有 24h DB 缓存）
    set({ loading: true });
    try {
      const { data } = await axios.get('/api/ext/exchange', {
        params: { from: 'CNY' },
        timeout: 8000,
      });
      const payload = data.data || {};
      // 语义校验：rates 必须是 rateToCny 方向（1 单位外币 = X CNY）。
      // 方向不符时拒绝使用并走兜底，避免把反向汇率当成 rateToCny 参与换算。
      if (payload.rateType && payload.rateType !== RATE_TYPE_RATE_TO_CNY) {
        throw new Error(`Unexpected exchange rateType: ${payload.rateType}`);
      }
      const rates = payload.rates || {};
      const date = payload.date || today;
      const savedAt = new Date().toISOString();
      saveRatesCache({ date, rates, savedAt });
      set({ rates, loading: false, lastUpdated: savedAt });
    } catch {
      // 3. 请求失败：回退本地缓存；无缓存则用内置近似汇率
      if (cached) {
        set({ rates: cached.rates, loading: false, lastUpdated: cached.savedAt });
        return;
      }
      set({
        // rateToCny 方向的内置参考汇率（与后端 FALLBACK_RATES 一致）
        rates: {
          USD: 7.14285714,
          EUR: 7.69230769,
          GBP: 9.09090909,
          JPY: 0.04878049,
          KRW: 0.00540541,
        },
        loading: false,
        lastUpdated: null,
      });
    }
  },

  convert: (amountCNY: number) => {
    const { currency, rates } = get();
    if (currency.code === 'CNY') return amountCNY;
    // rates 为 rateToCny 语义（1 单位外币 = X CNY），CNY → 外币需除以汇率
    const rate = rates[currency.code];
    if (!rate) return amountCNY;
    return amountCNY / rate;
  },

  format: (amountCNY: number) => {
    const { currency } = get();
    const converted = get().convert(amountCNY);

    if (currency.code === 'JPY' || currency.code === 'KRW') {
      // 日元/韩元无小数
      return `${currency.symbol}${Math.round(converted).toLocaleString()}`;
    }
    return `${currency.symbol}${converted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  },

  getRateToCNY: () => {
    const { currency, rates } = get();
    if (currency.code === 'CNY') return null;
    // rates 已是 rateToCny（1 单位外币 = X CNY），直接展示
    const rate = rates[currency.code];
    if (!rate) return null;
    if (currency.code === 'JPY' || currency.code === 'KRW') {
      return `1 ${currency.code} ≈ ${rate.toFixed(4)} CNY`;
    }
    return `1 ${currency.code} ≈ ${rate.toFixed(3)} CNY`;
  },
}));
