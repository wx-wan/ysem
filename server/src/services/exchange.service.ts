import { Currency, Prisma } from '@prisma/client';
import { DomainError } from '../lib/errors';
import { exchangeRepository } from '../repositories';
import {
  BASE_CURRENCY,
  decimalToNumber,
  isQuotedCurrency,
  normalizeRate,
  QUOTED_CURRENCIES,
} from '../utils/currency';

/**
 * Exchange Business Layer —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 职责：汇率主数据的获取、方向归一化（`rateToCny`）、缓存命中策略、外部源失败回退顺序。
 * 约束：不读 req / res、不直接 import Prisma 单例（`Prisma.*` 仅作类型与 Decimal 值使用）。
 *
 * 【业务语义冻结（沿用既有实现，未改）】
 *   · 响应 `rates[X]` = **1 单位 X = rates[X] CNY**（V1.0 `rateToCny`）；
 *   · 外部源（Frankfurter）以 `from=CNY` 报价，返回 **1 CNY = X 目标币**（`perCny` 方向），
 *     必须经 `normalizeRate` 取倒数归一化 —— **不得**通过改字段名把反向汇率写成 `rateToCny`；
 *   · 该接口是**展示辅助**（前端顶栏换算），数值以 number 返回；账务金额一律按 ADR-16 序列化为字符串。
 */

const RATE_TYPE = 'rateToCny' as const;
const EXTERNAL_RATE_DIRECTION = 'perCny' as const;

/**
 * 外部 API 不可用时的内置参考汇率 —— **rateToCny 方向**（1 目标币 = X CNY）。
 * 数值来源：由旧版 CNY 基准参考汇率取倒数得到；不追求实时金融准确性。
 */
const FALLBACK_RATES: Record<string, number> = {
  CNY: 1,
  USD: 7.14285714, // 1 / 0.14
  EUR: 7.69230769, // 1 / 0.13
  GBP: 9.09090909, // 1 / 0.11
  JPY: 0.04878049, // 1 / 20.5
  KRW: 0.00540541, // 1 / 185
};

interface RateRow {
  date: Date;
  currencyCode: Currency;
  rateToCny: Prisma.Decimal;
}

export interface RatePayload {
  base: string;
  rateType: 'rateToCny';
  date: string;
  rates: Record<string, number>;
}

export function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `YYYY-MM-DD` → Prisma `DateTime` 参数（UTC 零点）。
 *
 * `DailyExchangeRate.date` 是 `DateTime @db.Date`：传纯日期串会被 Prisma 参数校验拒绝
 * （premature end of input. Expected ISO-8601 DateTime）→ 500。
 * 此处显式补齐时间与 `Z`，不使用隐式解析，避免时区歧义。
 */
export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** 拉取外部汇率（CNY 基准方向）；返回值保持外部原始方向，由 buildRateRows 归一化 */
async function fetchRatesFromAPI(date: string): Promise<Record<string, number>> {
  const url =
    date === getToday()
      ? `https://api.frankfurter.app/latest?from=${BASE_CURRENCY}&to=${QUOTED_CURRENCIES.join(',')}`
      : `https://api.frankfurter.app/${date}?from=${BASE_CURRENCY}&to=${QUOTED_CURRENCIES.join(',')}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number> };
  return data.rates || {};
}

/** 外部原始汇率（1 CNY = X 目标币）→ V1.0 `rateToCny` 落库记录 */
function buildRateRows(date: string, apiRates: Record<string, number>): RateRow[] {
  const rows: RateRow[] = [];
  for (const [code, rawRate] of Object.entries(apiRates)) {
    if (!isQuotedCurrency(code)) continue;
    const rateToCny = normalizeRate(rawRate, EXTERNAL_RATE_DIRECTION);
    if (!rateToCny) continue;
    rows.push({ date: toDbDate(date), currencyCode: code, rateToCny });
  }
  return rows;
}

const toResponseRates = (
  rows: Array<{ currencyCode: string; rateToCny: Prisma.Decimal }>,
): Record<string, number> => {
  const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
  rows.forEach((r) => {
    rates[r.currencyCode] = decimalToNumber(r.rateToCny) ?? 0;
  });
  return rates;
};

const ratePayload = (date: string, rates: Record<string, number>): RatePayload => ({
  base: BASE_CURRENCY,
  rateType: RATE_TYPE,
  date,
  rates,
});

/**
 * GET /api/ext/exchange —— 当日汇率（前端顶栏实时汇率）。
 * 24 小时缓存语义：当天 DB 已有记录直接返回；未命中才请求外部并落库；
 * 外部失败回退「最近历史缓存 → 内置参考值」。
 */
export async function getTodayRates(): Promise<RatePayload> {
  const today = getToday();

  // 1. DB 缓存命中（跨重启生效；date 列必须传 Date 对象）
  const existing = await exchangeRepository.findManyByDate(toDbDate(today));
  if (existing.length > 0) {
    return ratePayload(today, toResponseRates(existing));
  }

  // 2. 未命中：请求外部并落库
  let apiRates: Record<string, number>;
  try {
    apiRates = await fetchRatesFromAPI(today);
  } catch {
    // 3a. 外部失败：回退最近一次历史缓存
    const latest = await exchangeRepository.findLatest();
    if (latest) {
      const all = await exchangeRepository.findManyByDate(latest.date);
      return ratePayload(latest.date.toISOString().slice(0, 10), toResponseRates(all));
    }
    // 3b. 无任何历史：返回内置参考汇率（已是 rateToCny 方向）
    return ratePayload(today, { ...FALLBACK_RATES });
  }

  const entries = buildRateRows(today, apiRates);
  if (entries.length > 0) {
    try {
      await exchangeRepository.createMany(entries, true);
    } catch {
      /* 忽略重复写入 */
    }
  }

  return ratePayload(today, toResponseRates(entries));
}

/**
 * GET /api/exchange/daily?date=YYYY-MM-DD —— 指定日期汇率（先查库，未命中再请求外部并落库）。
 *
 * 注：本端点当前**未挂载任何路由**（见 Phase 2 报告「未挂载端点」），保留实现以维持 API 表面不变。
 */
export async function getDailyRates(dateInput?: string): Promise<RatePayload> {
  const date = dateInput || getToday();

  const existing = await exchangeRepository.findManyByDate(toDbDate(date));
  if (existing.length > 0) {
    return ratePayload(date, toResponseRates(existing));
  }

  let apiRates: Record<string, number>;
  try {
    apiRates = await fetchRatesFromAPI(date);
  } catch {
    // 外部失败：仅返回本位币，前端按 1:1 兜底
    return ratePayload(date, { [BASE_CURRENCY]: 1 });
  }

  const entries = buildRateRows(date, apiRates);
  if (entries.length > 0) {
    try {
      await exchangeRepository.createMany(entries, true);
    } catch {
      /* 忽略重复写入 */
    }
  }

  return ratePayload(date, toResponseRates(entries));
}

/**
 * POST /api/exchange/daily —— 强制刷新当日汇率（先外部拉取，成功后整体替换当天记录）。
 *
 * 注：本端点当前**未挂载任何路由**，保留实现以维持 API 表面不变。
 *
 * 【已记录的既有实现问题（本轮**不修**，仅记录）】
 *   `deleteMany({ where: { date: today } })` 传入的是 **`YYYY-MM-DD` 字符串**，
 *   而 `date` 列是 `DateTime @db.Date` —— 同文件其余路径均显式使用 `toDbDate()`。
 *   该写入条件会触发 Prisma 参数校验错误 → 由外层 `next(err)` 交由 errorHandler。
 *   修复属「业务行为修正」，按 Master Plan §17 需先经明确 Freeze，故本轮逐字保留。
 */
export async function ensureToday(): Promise<RatePayload> {
  const today = getToday();

  let apiRates: Record<string, number>;
  try {
    apiRates = await fetchRatesFromAPI(today);
  } catch {
    throw new DomainError('获取汇率失败，请稍后重试', { httpStatus: 502 });
  }

  const entries = buildRateRows(today, apiRates);
  if (entries.length === 0) {
    throw new DomainError('汇率源未返回可用数据，请稍后重试', { httpStatus: 502 });
  }

  // 删除旧的当天记录后重新写入（仅在新数据可用时替换，避免清空有效缓存）
  await exchangeRepository.deleteMany({ date: today });
  await exchangeRepository.createMany(entries, false);

  return ratePayload(today, toResponseRates(entries));
}
