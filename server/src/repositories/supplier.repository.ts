import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Supplier（供应商）数据访问 —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * 归属：Data Layer。Supplier 是**被采购单长期复用的主数据**（DQ-4=A：共享主数据，
 * 仅做存在性校验，**不施加 owner 数据范围**）。
 *
 * 只做持久化与查询；「名称是否合法 / 编号如何分配」属 Business 与 Operation 层。
 */
const model = (db: DbClient) => (db as typeof prisma).supplier;

export const supplierRepository = {
  /** 供应商下拉/搜索（既有口径：keyword 命中 name / contact，take 50，createdAt 倒序） */
  findManyByKeyword(keyword: string, db: DbClient = prisma) {
    const where: Prisma.SupplierWhereInput = keyword
      ? { OR: [{ name: { contains: keyword } }, { contact: { contains: keyword } }] }
      : {};
    return model(db).findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 });
  },

  /** 存在性校验（采购单引用） */
  findById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true } });
  },

  create(data: Prisma.SupplierUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  /** 批量存在性校验结果（供应商引用：只要求存在，不施加 owner scope） */
  async findExistingIds(ids: string[], db: DbClient = prisma): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await model(db).findMany({ where: { id: { in: ids } }, select: { id: true } });
    return rows.map((r) => r.id);
  },

};
