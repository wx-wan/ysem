import { Request, Response, NextFunction } from "express";
import prisma from "../lib/prisma";
import { success, error } from "../utils/response";

// Supported currencies for daily rate storage
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "KRW", "AUD", "CAD", "CHF"];

// 外部 API 不可用时的内置参考汇率（1 CNY = X 目标币种）
const FALLBACK_RATES: Record<string, number> = {
  CNY: 1,
  USD: 0.14,
  EUR: 0.13,
  GBP: 0.11,
  JPY: 20.5,
  KRW: 185,
};

/**
 * Fetch rates from Frankfurter API for a given date.
 * Returns an object: { USD: 0.14, EUR: 0.13, ... } meaning 1 CNY = X of target currency.
 */
async function fetchRatesFromAPI(date: string): Promise<Record<string, number>> {
  const url = date === getToday() 
    ? `https://api.frankfurter.app/latest?from=CNY&to=${SUPPORTED_CURRENCIES.join(",")}`
    : `https://api.frankfurter.app/${date}?from=CNY&to=${SUPPORTED_CURRENCIES.join(",")}`;
  
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
  const data = (await res.json()) as { rates?: Record<string, number> };
  return data.rates || {};
}

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

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
      const rates: Record<string, number> = { CNY: 1 };
      existing.forEach((r) => { rates[r.currencyCode] = r.ratePerCNY; });
      return success(res, { base: "CNY", date: today, rates });
    }

    // 2. 未命中：请求外部并落库
    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(today);
    } catch {
      // 3a. 外部失败：回退最近一次历史缓存
      const latest = await prisma.dailyExchangeRate.findFirst({ orderBy: { date: "desc" } });
      if (latest) {
        const all = await prisma.dailyExchangeRate.findMany({ where: { date: latest.date } });
        const rates: Record<string, number> = { CNY: 1 };
        all.forEach((r) => { rates[r.currencyCode] = r.ratePerCNY; });
        return success(res, { base: "CNY", date: latest.date, rates });
      }
      // 3b. 无任何历史：返回内置参考汇率
      return success(res, { base: "CNY", date: today, rates: { ...FALLBACK_RATES } });
    }

    const entries = Object.entries(apiRates)
      .filter(([code, rate]) => SUPPORTED_CURRENCIES.includes(code) && rate > 0)
      .map(([code, rate]) => ({ date: today, currencyCode: code, ratePerCNY: rate }));
    if (entries.length > 0) {
      try {
        await prisma.dailyExchangeRate.createMany({ data: entries, skipDuplicates: true });
      } catch { /* 忽略重复写入 */ }
    }

    const result: Record<string, number> = { CNY: 1, ...apiRates };
    return success(res, { base: "CNY", date: today, rates: result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/exchange/daily?date=YYYY-MM-DD
 * Returns exchange rates for a specific date.
 * Looks up DB first, falls back to Frankfurter API (and saves to DB).
 */
export const getDailyRates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = (req.query.date as string) || getToday();
    
    // 1. Try DB
    const existing = await prisma.dailyExchangeRate.findMany({
      where: { date },
    });

    if (existing.length > 0) {
      const rates: Record<string, number> = {};
      existing.forEach((r) => { rates[r.currencyCode] = r.ratePerCNY; });
      // Always include CNY as 1:1
      rates["CNY"] = 1;
      return success(res, { date, rates });
    }

    // 2. Fetch from Frankfurter
    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(date);
    } catch {
      // If API fails, return empty rates (frontend will fallback to 1:1)
      return success(res, { date, rates: { CNY: 1 } });
    }

    // 3. Save to DB
    const entries = Object.entries(apiRates)
      .filter(([code, rate]) => SUPPORTED_CURRENCIES.includes(code) && rate > 0)
      .map(([code, rate]) => ({ date, currencyCode: code, ratePerCNY: rate }));

    if (entries.length > 0) {
      try {
        await prisma.dailyExchangeRate.createMany({
          data: entries,
          skipDuplicates: true,
        });
      } catch {
        // Ignore duplicate errors
      }
    }

    const result: Record<string, number> = { CNY: 1 };
    entries.forEach((e) => { result[e.currencyCode] = e.ratePerCNY; });

    return success(res, { date, rates: result });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/exchange/daily
 * Force-refresh today's exchange rates.
 */
export const ensureToday = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const today = getToday();
    
    let apiRates: Record<string, number>;
    try {
      apiRates = await fetchRatesFromAPI(today);
    } catch {
      return error(res, "获取汇率失败，请稍后重试", 502);
    }

    // Delete old today entries and re-insert
    await prisma.dailyExchangeRate.deleteMany({ where: { date: today } });

    const entries = Object.entries(apiRates)
      .filter(([code, rate]) => SUPPORTED_CURRENCIES.includes(code) && rate > 0)
      .map(([code, rate]) => ({ date: today, currencyCode: code, ratePerCNY: rate }));

    if (entries.length > 0) {
      await prisma.dailyExchangeRate.createMany({ data: entries });
    }

    const result: Record<string, number> = { CNY: 1 };
    entries.forEach((e) => { result[e.currencyCode] = e.ratePerCNY; });

    return success(res, { date: today, rates: result });
  } catch (err) {
    next(err);
  }
};
