import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * DailyExchangeRate 数据访问（Round R-2 · Lead Pilot）
 *
 * 用途唯一：线索**创建时**抓取「1 USD = X CNY」快照（Lead.usdRate），
 * 与线索自身币种无关，创建后不再刷新。不涉及汇率维护（属 exchange 模块）。
 */
export const dailyExchangeRateRepository = {
  /** 指定日期的某币种汇率 */
  findOnDate(date: Date, currencyCode: 'USD', db: DbClient = prisma) {
    return db.dailyExchangeRate.findFirst({
      where: { date, currencyCode },
      select: { rateToCny: true },
    });
  },

  /** 最近一条历史汇率（当日缺失时的回退） */
  findLatest(currencyCode: 'USD', db: DbClient = prisma) {
    return db.dailyExchangeRate.findFirst({
      where: { currencyCode },
      orderBy: { date: 'desc' },
      select: { rateToCny: true },
    });
  },
};
