import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * DailyExchangeRate（每日汇率）数据访问 —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 归属：Data Layer。汇率是**被全系统复用的基础主数据**（金额换算三件套的来源）。
 * 只做持久化与查询；缓存策略、外部汇率源方向归一化、回退顺序均属 Business 层。
 *
 * 【签名说明】`deleteMany` 刻意接收 **Prisma where 条件**（而非强类型 Date），
 * 以便 Business 层逐字沿用既有调用形态；是否传 Date 对象由 Business 决定。
 */
export const exchangeRepository = {
  /** 指定日期的全部币种汇率 */
  findManyByDate(date: Date, db: DbClient = prisma) {
    return db.dailyExchangeRate.findMany({ where: { date } });
  },

  /** 最近有数据的一天（用于外部源失败时回退历史缓存） */
  findLatest(db: DbClient = prisma) {
    return db.dailyExchangeRate.findFirst({ orderBy: { date: 'desc' } });
  },

  /** 批量写入（skipDuplicates：重复日期的同日写入被忽略） */
  createMany(
    data: Prisma.DailyExchangeRateCreateManyInput[],
    skipDuplicates: boolean,
    db: DbClient = prisma,
  ) {
    return db.dailyExchangeRate.createMany({ data, skipDuplicates });
  },

  /** 按条件删除（强势替换当日记录时使用） */
  deleteMany(where: Prisma.DailyExchangeRateWhereInput, db: DbClient = prisma) {
    return db.dailyExchangeRate.deleteMany({ where });
  },
};
