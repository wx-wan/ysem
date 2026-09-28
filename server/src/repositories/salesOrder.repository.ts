import type { Prisma, SalesOrderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * SalesOrder 数据访问 —— **仅供 Customer 领域读模型使用**（Round R-3 · Customer Pilot）
 *
 * 范围限制：只提供 Customer 列表 / 报表实际需要的**只读聚合**，
 * 不迁移 SalesOrder 模块自身的 CRUD 与状态机（属后续模块轮次）。
 */
export const salesOrderRepository = {
  /** 按 customer where 汇总本币金额（客户列表「成交总额」口径） */
  sumAmountCnyByCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.salesOrder.aggregate({
      where: { customer: customerWhere },
      _sum: { totalAmountCny: true },
    });
  },

  /** 按客户 id 批量汇总金额 + 最近下单日（列表 enrichment，避免 N+1） */
  groupAmountByCustomerIds(customerIds: string[], db: DbClient = prisma) {
    return db.salesOrder.groupBy({
      by: ['customerId'],
      _sum: { totalAmountCny: true },
      _max: { orderDate: true },
      where: { customerId: { in: customerIds } },
    });
  },

  /** 按 customer where 取金额列表（报表口径：仅非空金额行） */
  findAmountsByCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.salesOrder.findMany({
      where: { customer: customerWhere, totalAmountCny: { not: null } },
      select: { totalAmountCny: true },
    });
  },

  /** 按状态计数（报表：已出货订单数） */
  countByStatus(status: SalesOrderStatus, db: DbClient = prisma) {
    return db.salesOrder.count({ where: { status } });
  },
};
