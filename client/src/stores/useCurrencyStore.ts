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
  // 汇率表: { USD: 7.25, EUR: 7.89, ... } 相对于 CNY
  rates: Record<string, number>;
  // 加载状态
  loading: boolean;
  // 上次更新时间
  lastUpdated: string | null;

  setCurrency: (code: string) => void;
  fetchRates: () => Promise<void>;
  // 获取指定日期的汇率（从后端每日汇率缓存读取）
  fetchRatesForDate: (date: string) => Promise<Record<string, number>>;
  // 转换金额
  convert: (amountCNY: number) => number;
  // 格式化金额
  format: (amountCNY: number) => string;
  // 按历史日期格式化金额（订单成交日期）
  formatWithDate: (amountCNY: number, date: string) => Promise<string>;
  // 获取当前币种兑 CNY 的汇率展示文本
  getRateToCNY: () => string | null;
}

const STORAGE_KEY = 'ysem_currency';
const RATES_KEY = 'ysem_currency_rates';
// 汇率缓存有效期：24 小时内不重复请求
const RATES_TTL_MS = 24 * 60 * 60 * 1000;

function loadSavedRates(): { rates: Record<string, number>; lastUpdated: string } | null {
  try {
    const raw = localStorage.getItem(RATES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { rates: Record<string, number>; lastUpdated: string };
    if (!parsed.rates || !parsed.lastUpdated) return null;
    const age = Date.now() - new Date(parsed.lastUpdated).getTime();
    if (age > RATES_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveRates(rates: Record<string, number>, lastUpdated: string) {
  try {
    localStorage.setItem(RATES_KEY, JSON.stringify({ rates, lastUpdated }));
  } catch {}
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
    // 优先使用本地缓存（24h 内有效），避免每次刷新都请求汇率
    const cached = loadSavedRates();
    if (cached) {
      set({ rates: cached.rates, loading: false, lastUpdated: cached.lastUpdated });
      return;
    }

    set({ loading: true });
    try {
      // 通过后端代理请求 Frankfurter，避免 CORS 问题
      const { data } = await axios.get('/api/ext/exchange', {
        params: { from: 'CNY' },
        timeout: 8000,
      });
      const rates = data.data?.rates || {};
      const lastUpdated = new Date().toISOString();
      saveRates(rates, lastUpdated);
      set({ rates, loading: false, lastUpdated });
    } catch {
      // 降级：使用内置近似汇率
      const rates = {
        USD: 0.14,
        EUR: 0.13,
        GBP: 0.11,
        JPY: 20.5,
        KRW: 185,
      };
      set({ rates, loading: false, lastUpdated: null });
    }
  },

  convert: (amountCNY: number) => {
    const { currency, rates } = get();
    if (currency.code === 'CNY') return amountCNY;
    const rate = rates[currency.code];
    if (!rate) return amountCNY;
    return amountCNY * rate;
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
    const rate = rates[currency.code];
    if (!rate) return null;
    // rate 表示 1 CNY = rate <target>，因此 1 <target> = 1/rate CNY
    const toCNY = 1 / rate;
    if (currency.code === 'JPY' || currency.code === 'KRW') {
      return `1 ${currency.code} ≈ ${toCNY.toFixed(4)} CNY`;
    }
    return `1 ${currency.code} ≈ ${toCNY.toFixed(3)} CNY`;
  },

  fetchRatesForDate: async (date: string) => {
    try {
      const { data } = await axios.get('/api/ext/exchange', {
        params: { from: 'CNY', date },
        timeout: 8000,
      });
      return data.data?.rates || {};
    } catch {
      // 降级：使用当前汇率表
      const { rates } = get();
      return rates;
    }
  },

  formatWithDate: async (amountCNY: number, date: string) => {
    const { currency } = get();
    if (currency.code === 'CNY') {
      return `${currency.symbol}${amountCNY.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
    const rates = await get().fetchRatesForDate(date);
    const rate = rates[currency.code];
    if (!rate) return get().format(amountCNY);
    const converted = amountCNY * rate;
    if (currency.code === 'JPY' || currency.code === 'KRW') {
      return `${currency.symbol}${Math.round(converted).toLocaleString()}`;
    }
    return `${currency.symbol}${converted.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  },
}));
