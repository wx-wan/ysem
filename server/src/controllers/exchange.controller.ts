import { Request, Response, NextFunction } from "express";
import { success, error } from "../utils/response";
import prisma from "../lib/prisma";

// Supported currencies for daily rate storage
const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "KRW", "AUD", "CAD", "CHF"];

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
