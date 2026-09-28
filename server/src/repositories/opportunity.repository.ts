import type { IntentLevel, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Opportunity 数据访问（Data Layer）
 *
 * 两种角色（R-5.2 · D15 澄清）：
 *   ① **Opportunity 业务域的权威访问**（Round R-5 · Phase 1 Sales Process Domain 扩充）；
 *   ② **Customer 领域只读读模型**（Round R-3 建立，方法语义与签名保持不变）。
 *
 * 约束：只做数据访问，不含业务规则、不含权限政策、不含状态判断。
 */

const opportunityModel = (db: DbClient) => (db as typeof prisma).opportunity;

export const opportunityRepository = {
  // ============================================================
  // ① Customer 读模型（R-3 建立，语义不变）
  // ============================================================

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

  // ============================================================
  // ② Opportunity 属主访问（Round R-5 · Phase 1）
  // ============================================================

  findMany<T extends Prisma.OpportunityFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OpportunityGetPayload<T>[]> {
    return opportunityModel(db).findMany(args as Prisma.OpportunityFindManyArgs) as unknown as Promise<
      Prisma.OpportunityGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.OpportunityFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OpportunityGetPayload<T> | null> {
    return opportunityModel(db).findFirst(args as Prisma.OpportunityFindFirstArgs) as unknown as Promise<
      Prisma.OpportunityGetPayload<T> | null
    >;
  },

  count(where?: Prisma.OpportunityWhereInput, db: DbClient = prisma): Promise<number> {
    return opportunityModel(db).count(where ? { where } : undefined);
  },

  create<T extends Prisma.OpportunityCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OpportunityGetPayload<T>> {
    return opportunityModel(db).create(args as Prisma.OpportunityCreateArgs) as unknown as Promise<
      Prisma.OpportunityGetPayload<T>
    >;
  },

  update<T extends Prisma.OpportunityUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OpportunityGetPayload<T>> {
    return opportunityModel(db).update(args as Prisma.OpportunityUpdateArgs) as unknown as Promise<
      Prisma.OpportunityGetPayload<T>
    >;
  },

  delete<T extends Prisma.OpportunityDeleteArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.OpportunityGetPayload<T>> {
    return opportunityModel(db).delete(args as Prisma.OpportunityDeleteArgs) as unknown as Promise<
      Prisma.OpportunityGetPayload<T>
    >;
  },

  deleteMany(where: Prisma.OpportunityWhereInput, db: DbClient = prisma) {
    return opportunityModel(db).deleteMany({ where });
  },

  /** 明细整表重建用：清空某商机全部 OpportunityItem */
  deleteItemsByOpportunityId(opportunityId: string, db: DbClient = prisma) {
    return db.opportunityItem.deleteMany({ where: { opportunityId } });
  },

  /** 批量读取「产品 id → 名称」（商机明细快照用；授权条件由调用方给出） */
  findVisibleProductNames(productIds: string[], visibilityWhere: Prisma.ProductWhereInput = {}, db: DbClient = prisma) {
    return db.product.findMany({
      where: { id: { in: productIds }, ...visibilityWhere },
      select: { id: true, name: true },
    });
  },
};
