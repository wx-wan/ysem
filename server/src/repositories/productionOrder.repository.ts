import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * ProductionOrder 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】
 *   审批流水为**多态旁挂**（`bizType + businessId`，schema 无外键），审批域必须按 bizType
 *   直接读取各业务表的主键与编号。本文件当前只提供这批**只读**能力。
 *
 * 【演进约定（R-5.2 · D15）】D1 履约域迁移时将**就地扩展**本仓储，
 *   不得新建平行仓储（如 `productionOrderRepository2` / `production.repository`）。
 */
const model = (db: DbClient) => (db as typeof prisma).productionOrder;

export const productionOrderRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, productionNo: true } });
  },

  /** 审批 Scope 白名单：当前用户可见的业务对象 id（scope 条件由调用方给出） */
  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.ProductionOrderWhereInput,
      select: { id: true },
    });
  },
};
