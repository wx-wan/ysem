import type { IntentLevel, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Opportunity 数据访问 —— **仅供 Customer 领域读模型 / 意向派生使用**（Round R-3 · Customer Pilot）
 *
 * 范围限制：只提供 Customer 列表 / 详情 / 报表实际需要的**只读**方法，
 * 不迁移 Opportunity 模块自身的 CRUD 与阶段派生服务（属后续模块轮次）。
 *
 * 重要：本文件只提供**读取**。Customer 领域的「意向」为**读时派生**
 * （取客户关联商机中的最高 `intentLevel`），派生规则属 Business Layer（utils/customerIntent.ts），
 * 仓储不判定也不回写。
 */
export const opportunityRepository = {
  /** 按 customer where 汇总预计金额（客户列表「商机总额」口径） */
  sumEstimatedAmountByCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.opportunity.aggregate({
      where: { customer: customerWhere },
      _sum: { estimatedAmount: true },
    });
  },

  /** 按 customer where 汇总金额 + 计数（按商机意向分组） */
  groupEstimatedByIntentLevelForCustomerWhere(customerWhere: Prisma.CustomerWhereInput, db: DbClient = prisma) {
    return db.opportunity.groupBy({
      by: ['intentLevel'],
      where: { customer: customerWhere },
      _sum: { estimatedAmount: true },
      _count: true,
    });
  },

  /**
   * 按 (customerId, intentLevel) 计数聚合。
   * 客户列表 enrichment 与 Customer 统计共用（口径完全一致），
   * 只取数据、不做任何意向判定（判定在 Business 层的 deriveCustomerIntentLevels）。
   */
  groupCountByCustomerAndIntent(
    where: Prisma.OpportunityWhereInput,
    db: DbClient = prisma,
  ): Promise<{ customerId: string; intentLevel: IntentLevel | null; _count: number }[]> {
    return db.opportunity.groupBy({
      by: ['customerId', 'intentLevel'],
      where,
      _count: true,
    }) as unknown as Promise<{ customerId: string; intentLevel: IntentLevel | null; _count: number }[]>;
  },

  /** 按客户 id 批量取商机金额（列表 enrichment，避免 N+1） */
  groupEstimatedAmountByCustomerIds(customerIds: string[], db: DbClient = prisma) {
    return db.opportunity.groupBy({
      by: ['customerId'],
      _sum: { estimatedAmount: true },
      where: { customerId: { in: customerIds } },
    });
  },

  /** 报表：按 where 取 (id, leadId) 供派生阶段计数（不落库阶段，读时派生） */
  findForStageDerivation(where: Prisma.OpportunityWhereInput, db: DbClient = prisma) {
    return db.opportunity.findMany({ where, select: { id: true, leadId: true } });
  },
};
