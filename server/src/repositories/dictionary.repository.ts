import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Dictionary（基础字典）数据访问 —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 【为什么是一个仓储而不是四个】
 *   `CurrencyRate` / `Unit` / `CustomerType` / `CommunicationTool` 四张表在业务上
 *   属于**同一个字典域**（可维护的基础选项集），且既有四个 Controller 的实现
 *   逐行同构（list / active-list / detail / create(排序自增) / update / delete / batch-sort）。
 *   按 Master Execution Plan「Domain First, Layer Second」，此处按**域**收敛一次数据访问适配，
 *   而不是为四张结构相同的表复制四份等价仓储（那才是「为了形式制造层」）。
 *
 * 约束：只做持久化与查询，不含业务规则、不含权限政策、不含 HTTP。
 * 表名只允许来自 `DictionaryTable` 白名单（不接受外部任意字符串，避免动态表名风险）。
 */

/** 允许的字典表（与 Prisma 模型 delegate 名一致） */
export type DictionaryTable = 'currencyRate' | 'unit' | 'customerType' | 'communicationTool';

export const DICTIONARY_TABLES: readonly DictionaryTable[] = [
  'currencyRate',
  'unit',
  'customerType',
  'communicationTool',
] as const;

/**
 * 字典 delegate 的**最小公共形状**。
 * 四张表的 delegate 形状一致，但 Prisma 无法对「表名联合」做泛型推导，
 * 因此在此收敛一次断言；仓储内部不使用任何表特有的方法。
 */
interface DictionaryDelegate {
  findMany(args?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
  findUnique(args: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  create(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  delete(args: Record<string, unknown>): Promise<Record<string, unknown>>;
  aggregate(args: Record<string, unknown>): Promise<{ _max: { sort: number | null } }>;
}

const delegateOf = (db: DbClient, table: DictionaryTable): DictionaryDelegate =>
  (db as unknown as Record<string, DictionaryDelegate>)[table];

/** 列表固定排序（与既有实现逐字一致：sort 升序 → createdAt 升序） */
const LIST_ORDER_BY = [{ sort: 'asc' }, { createdAt: 'asc' }];

export const dictionaryRepository = {
  /** 全部行（可选 keyword 的 OR 条件由调用方给出明确字段） */
  findMany(
    table: DictionaryTable,
    where: Record<string, unknown> | undefined,
    db: DbClient = prisma,
  ): Promise<Record<string, unknown>[]> {
    return delegateOf(db, table).findMany({ where, orderBy: LIST_ORDER_BY });
  },

  /** 单行 */
  findById(table: DictionaryTable, id: string, db: DbClient = prisma) {
    return delegateOf(db, table).findUnique({ where: { id } });
  },

  /** 当前最大 sort（新增时 sort 自增的基准；空表为 null） */
  async maxSort(table: DictionaryTable, db: DbClient = prisma): Promise<number | null> {
    const r = await delegateOf(db, table).aggregate({ _max: { sort: true } });
    return r._max.sort ?? null;
  },

  create(table: DictionaryTable, data: Record<string, unknown>, db: DbClient = prisma) {
    return delegateOf(db, table).create({ data });
  },

  update(table: DictionaryTable, id: string, data: Record<string, unknown>, db: DbClient = prisma) {
    return delegateOf(db, table).update({ where: { id }, data });
  },

  delete(table: DictionaryTable, id: string, db: DbClient = prisma) {
    return delegateOf(db, table).delete({ where: { id } });
  },

  /** 单行排序写入（批量排序在同一事务内逐条调用） */
  updateSort(table: DictionaryTable, id: string, sort: number, db: DbClient = prisma) {
    return delegateOf(db, table).update({ where: { id }, data: { sort } });
  },
};
