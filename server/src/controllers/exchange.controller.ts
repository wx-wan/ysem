import { Currency, Prisma } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../utils/response';
import {
  BASE_CURRENCY,
  decimalToNumber,
  isQuotedCurrency,
  normalizeRate,
  QUOTED_CURRENCIES,
} from '../utils/currency';

/**
 * 汇率响应语义标记：`rates[X]` 表示 **1 单位 X = rates[X] CNY**（V1.0 rateToCny）。
 */
const RATE_TYPE = 'rateToCny' as const;

/**
 * 外部汇率源（Frankfurter）以 `from=CNY` 报价，返回 **1 CNY = X 目标币**，
 * 即旧 `ratePerCNY` 方向，必须显式声明并经 `normalizeRate` 取倒数归一化，
 * 不得通过「字段改名」把反向汇率直接写成 `rateToCny`。
 */
const EXTERNAL_RATE_DIRECTION = 'perCny' as const;

/**
 * 外部 API 不可用时的内置参考汇率 —— **rateToCny 方向**（1 目标币 = X CNY）。
 *
 * 数值来源：由旧版 CNY 基准参考汇率（1 CNY = X 目标币）取倒数得到，
 * 保证方向正确、量级正确；本轮不追求汇率数据的实时金融准确性。
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
  date: string;
  currencyCode: Currency;
  rateToCny: Prisma.Decimal;
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 拉取外部汇率（CNY 基准方向：1 CNY = X 目标币）。
 * 返回值保持外部原始方向，由 `buildRateRows` 统一归一化。
 */
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

/**
 * 外部原始汇率（1 CNY = X 目标币）→ V1.0 `rateToCny` 落库记录。
 * 只保留 `Currency` 枚举内支持的币种（旧实现硬编码的 CHF 已被剔除）。
 */
function buildRateRows(date: string, apiRates: Record<string, number>): RateRow[] {
  const rows: RateRow[] = [];
  for (const [code, rawRate] of Object.entries(apiRates)) {
    if (!isQuotedCurrency(code)) continue;
    const rateToCny = normalizeRate(rawRate, EXTERNAL_RATE_DIRECTION);
    if (!rateToCny) continue;
    rows.push({ date, currencyCode: code, rateToCny });
  }
  return rows;
}

/**
 * 落库记录 → 接口响应字典。
 * 该接口是**展示辅助**（前端顶栏换算），非账务 API，因此数值以 number 返回；
 * 账务金额一律在业务接口中按 ADR-16 序列化为字符串。
 */
const toResponseRates = (
  rows: Array<{ currencyCode: string; rateToCny: Prisma.Decimal }>,
): Record<string, number> => {
  const rates: Record<string, number> = { [BASE_CURRENCY]: 1 };
  rows.forEach((r) => {
    rates[r.currencyCode] = decimalToNumber(r.rateToCny) ?? 0;
  });
  return rates;
};

const ratePayload = (date: string, rates: Record<string, number>) => ({
  base: BASE_CURRENCY,
  rateType: RATE_TYPE,
  date,
  rates,
});

/**
 * GET /api/ext/exchange（前端顶栏实时汇率）
 * 带 24 小时缓存：当天 DB 已有记录直接返回，不重复请求外部 API；
 * 未命中才请求 Frankfurter 并落库；外部失败时回退最近历史缓存 / 内置参考值。
 */
export const getTodayRates = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const today = getToday();

    // 1. DB 缓存命中（跨重启同样生效，每天自然按日期刷新）
    const existing = await prisma.dailyExchangeRate.findMany({ where: { date: today } });
    if (existing.length > 0) {
      return success(res, ratePayload(today, toResponseRates(existing)));
    }

    // 2. 未命中：请求外部并落库
    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(today);
    } catch {
      // 3a. 外部失败：回退最近一次历史缓存
      const latest = await prisma.dailyExchangeRate.findFirst({
        orderBy: { date: 'desc' },
      });
      if (latest) {
        const all = await prisma.dailyExchangeRate.findMany({
          where: { date: latest.date },
        });
        return success(res, ratePayload(latest.date.toISOString().slice(0, 10), toResponseRates(all)));
      }
      // 3b. 无任何历史：返回内置参考汇率（已是 rateToCny 方向）
      return success(res, ratePayload(today, { ...FALLBACK_RATES }));
    }

    const entries = buildRateRows(today, apiRates);
    if (entries.length > 0) {
      try {
        await prisma.dailyExchangeRate.createMany({ data: entries, skipDuplicates: true });
      } catch {
        /* 忽略重复写入 */
      }
    }

    return success(res, ratePayload(today, toResponseRates(entries)));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exchange/daily?date=YYYY-MM-DD
 * 指定日期的汇率（先查库，未命中再请求外部并落库）。
 */
export const getDailyRates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = (req.query.date as string) || getToday();

    // 1. 查库
    const existing = await prisma.dailyExchangeRate.findMany({ where: { date } });
    if (existing.length > 0) {
      return success(res, ratePayload(date, toResponseRates(existing)));
    }

    // 2. 请求外部
    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(date);
    } catch {
      // 外部失败：仅返回本位币，前端按 1:1 兜底
      return success(res, ratePayload(date, { [BASE_CURRENCY]: 1 }));
    }

    // 3. 归一化后落库
    const entries = buildRateRows(date, apiRates);
    if (entries.length > 0) {
      try {
        await prisma.dailyExchangeRate.createMany({ data: entries, skipDuplicates: true });
      } catch {
        /* 忽略重复写入 */
      }
    }

    return success(res, ratePayload(date, toResponseRates(entries)));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/exchange/daily
 * 强制刷新当日汇率（先外部拉取，成功后整体替换当天记录）。
 */
export const ensureToday = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const today = getToday();

    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(today);
    } catch {
      return error(res, '获取汇率失败，请稍后重试', 502);
    }

    const entries = buildRateRows(today, apiRates);
    if (entries.length === 0) {
      return error(res, '汇率源未返回可用数据，请稍后重试', 502);
    }

    // 删除旧的当天记录后重新写入（仅在新数据可用时替换，避免清空有效缓存）
    await prisma.dailyExchangeRate.deleteMany({ where: { date: today } });
    await prisma.dailyExchangeRate.createMany({ data: entries });

    return success(res, ratePayload(today, toResponseRates(entries)));
  } catch (err) {
    next(err);
  }
};
