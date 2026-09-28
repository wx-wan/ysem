import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * Payment 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】多态审批引用读取（只读）。
 * 【演进约定（R-5.2 · D15）】D2 财务域迁移时就地扩展本仓储，不新建平行仓储。
 *
 * 注意：Payment **自身无 ownerId**，数据范围经 `salesOrder` / `purchaseOrder` 关系继承
 * （scope 由调用方组装，如 `{ OR: [{ salesOrder: ownerScope }, { purchaseOrder: ownerScope }] }`）。
 */
const model = (db: DbClient) => (db as typeof prisma).payment;

export const paymentRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, paymentNo: true } });
  },

  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.PaymentWhereInput,
      select: { id: true },
    });
  },
};
