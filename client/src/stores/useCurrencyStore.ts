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
const RATES_KEY = 'ysem_rates';

const RATES_TTL = 24 * 60 * 60 * 1000; // 24 小时缓存

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

// 从 localStorage 恢复汇率缓存（含上次更新时间）
function loadSavedRates(): { rates: Record<string, number>; lastUpdated: string | null } {
  try {
    const saved = localStorage.getItem(RATES_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && parsed.rates) {
        return { rates: parsed.rates, lastUpdated: parsed.lastUpdated || null };
      }
    }
  } catch {}
  return { rates: {}, lastUpdated: null };
}

function saveRates(rates: Record<string, number>, lastUpdated: string): void {
  try {
    localStorage.setItem(RATES_KEY, JSON.stringify({ rates, lastUpdated }));
  } catch {}
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  currency: loadSavedCurrency(),
  rates: loadSavedRates().rates,
  loading: false,
  lastUpdated: loadSavedRates().lastUpdated,

  setCurrency: (code: string) => {
    const found = CURRENCIES.find((c) => c.code === code);
    if (found) {
      localStorage.setItem(STORAGE_KEY, code);
      set({ currency: found });
    }
  },

  fetchRates: async () => {
    // 24 小时内已成功获取过汇率则复用缓存，不再请求后端
    const { lastUpdated, rates } = get();
    if (lastUpdated && Object.keys(rates).length && Date.now() - new Date(lastUpdated).getTime() < RATES_TTL) {
      return;
    }
    set({ loading: true });
    try {
      // 通过后端代理请求 Frankfurter，避免 CORS 问题
      const { data } = await axios.get('/api/ext/exchange', {
        params: { from: 'CNY' },
        timeout: 8000,
      });
      const fetched = data.data?.rates || {};
      const updatedAt = new Date().toISOString();
      saveRates(fetched, updatedAt);
      set({
        rates: fetched,
        loading: false,
        lastUpdated: updatedAt,
      });
    } catch {
      // 降级：使用内置近似汇率（不写入缓存，下次仍尝试拉取真实汇率）
      set({
        rates: {
          USD: 0.14,
          EUR: 0.13,
          GBP: 0.11,
          JPY: 20.5,
          KRW: 185,
        },
        loading: false,
        lastUpdated: null,
      });
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
}));
