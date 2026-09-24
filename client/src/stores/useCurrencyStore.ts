import { create } from 'zustand';
import axios from 'axios';
import { currencyApi, CurrencyRate } from '../api/currency';

export interface CurrencyInfo {
  code: string; // ISO 4217，如 CNY / USD
  symbol: string; // 符号，如 ¥ / $
  label: string; // 英文/代码标签，如 CNY
  labelZh: string; // 中文名，如 人民币
}

interface CurrencyState {
  currency: CurrencyInfo;
  currencies: CurrencyInfo[];
  /** 汇率表（rateToCny 语义）：{ USD: 7.1428 }，即 1 单位该币种 = X CNY */
  rates: Record<string, number>;
  loading: boolean;
  ratesLoading: boolean;
  lastUpdated: number | null;
  setCurrency: (code: string) => void;
  fetchRates: () => Promise<void>;
  getRateToCNY: () => number;
  convert: (amountCNY: number) => number;
  format: (amountCNY: number, opts?: { currency?: CurrencyInfo | null; showCode?: boolean; showSymbol?: boolean }) => string;
}

const STORAGE_KEY = 'ysem-currency';
const RATES_CACHE_KEY = 'ysem_exchange_rates';

/** 后端汇率语义标记：rates[X] 表示 1 单位 X = rates[X] CNY（V1.0 rateToCny） */
const RATE_TYPE_RATE_TO_CNY = 'rateToCny';

/** 汇率本地缓存结构（按天缓存，当天不再向后端请求） */
interface RatesCache {
  date: string; // 汇率对应日期 YYYY-MM-DD
  rates: Record<string, number>;
  savedAt: string; // ISO 时间戳
}

/** 币种接口不可用时的兜底列表（仅用于首屏 / 请求失败） */
const FALLBACK_CURRENCIES: CurrencyInfo[] = [
  { code: 'CNY', symbol: '¥', label: 'CNY', labelZh: '人民币' },
  { code: 'USD', symbol: '$', label: 'USD', labelZh: '美元' },
  { code: 'EUR', symbol: '€', label: 'EUR', labelZh: '欧元' },
  { code: 'GBP', symbol: '£', label: 'GBP', labelZh: '英镑' },
  { code: 'JPY', symbol: '¥', label: 'JPY', labelZh: '日元' },
  { code: 'KRW', symbol: '₩', label: 'KRW', labelZh: '韩元' },
];

/** rateToCny 方向的内置参考汇率（与后端 FALLBACK_RATES 一致），仅外部源与历史缓存均不可用时兜底 */
const FALLBACK_RATES: Record<string, number> = {
  CNY: 1,
  USD: 7.14285714,
  EUR: 7.69230769,
  GBP: 9.09090909,
  JPY: 0.04878049,
  KRW: 0.00540541,
};

function mapCurrency(c: CurrencyRate): CurrencyInfo {
  return {
    code: c.code,
    symbol: c.symbol,
    label: c.code,
    labelZh: c.name,
  };
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
  } catch {
    /* 存储失败不影响使用 */
  }
}

export const useCurrencyStore = create<CurrencyState>((set, get) => ({
  // 初始默认 CNY，避免首屏 fetch 未完成时 currency 为 null 导致渲染崩溃；fetchRates 后会覆盖
  currency: { code: 'CNY', symbol: '¥', label: 'CNY', labelZh: '人民币' },
  currencies: FALLBACK_CURRENCIES,
  rates: {},
  loading: false,
  ratesLoading: false,
  lastUpdated: null,

  // 切换币种（仅允许切换到列表中已启用的币种）
  setCurrency: (code) => {
    const target = get().currencies.find((c) => c.code === code);
    if (!target) return;
    localStorage.setItem(STORAGE_KEY, code);
    set({ currency: target });
  },

  fetchRates: async () => {
    set({ loading: true, ratesLoading: true });
    try {
      // 1. 币种列表（系统设置 → 数据管理维护：代码 / 名称 / 符号）
      try {
        const list = await currencyApi.getActive();
        const currencies = list.map(mapCurrency);
        if (currencies.length) {
          const saved = localStorage.getItem(STORAGE_KEY);
          const currency = currencies.find((c) => c.code === saved) || currencies[0] || get().currency;
          set({ currencies, currency });
        }
      } catch {
        // 保留上一次成功的数据（首次则沿用兜底列表）
      }

      // 2. 汇率：按天本地缓存命中则直接使用，不再请求后端
      const cached = loadRatesCache();
      const today = new Date().toISOString().slice(0, 10);
      if (cached && cached.savedAt.slice(0, 10) === today) {
        set({ rates: cached.rates, lastUpdated: Date.parse(cached.savedAt) });
        return;
      }

      // 3. 未命中：请求每日汇率接口（后端自身有 DB 缓存；失败回退历史缓存 / 内置参考汇率）
      try {
        const { data } = await axios.get('/api/ext/exchange', {
          params: { from: 'CNY' },
          timeout: 8000,
        });
        const payload = data.data || {};
        // 语义校验：rates 必须是 rateToCny 方向（1 单位外币 = X CNY）
        if (payload.rateType && payload.rateType !== RATE_TYPE_RATE_TO_CNY) {
          throw new Error(`Unexpected exchange rateType: ${payload.rateType}`);
        }
        const rates = (payload.rates || {}) as Record<string, number>;
        const savedAt = new Date().toISOString();
        saveRatesCache({ date: payload.date || today, rates, savedAt });
        set({ rates, lastUpdated: Date.parse(savedAt) });
      } catch {
        set({
          rates: cached?.rates ?? FALLBACK_RATES,
          lastUpdated: cached ? Date.parse(cached.savedAt) : null,
        });
      }
    } finally {
      set({ loading: false, ratesLoading: false });
    }
  },

  // 当前币种兑 CNY 的汇率（rateToCny：1 单位当前币种 = X CNY；CNY 自身为 1）
  getRateToCNY: () => {
    const { currency, rates } = get();
    if (currency.code === 'CNY') return 1;
    const rate = rates[currency.code];
    return rate && rate > 0 ? rate : 1;
  },

  // CNY 金额换算为「当前币种」金额：amountCNY / rateToCny
  convert: (amountCNY) => amountCNY / get().getRateToCNY(),

  // CNY 金额格式化为「当前币种」展示
  format: (amountCNY, opts = {}) => {
    const { currency: cur = get().currency, showCode = true, showSymbol = true } = opts;
    const numberFormat = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (cur == null) {
      return numberFormat.format(amountCNY);
    }
    // 传入了指定币种时按其自身汇率换算，否则按当前币种
    const rate = cur.code === 'CNY' ? 1 : get().rates[cur.code] || 1;
    const converted = amountCNY / rate;
    const num = numberFormat.format(converted);
    const symbol = showSymbol && cur.symbol ? `${cur.symbol} ` : '';
    const code = showCode ? ` ${cur.code}` : '';
    return `${symbol}${num}${code}`.trim();
  },
}));
