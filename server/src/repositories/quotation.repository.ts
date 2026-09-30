import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../scope';
import type { DbClient } from './types';

/**
 * Quotation 数据访问（Data Layer）—— Round R-5 · Phase 1 Sales Process Domain
 *
 * 归属：Data Layer。只做持久化与查询，不含业务规则、不含权限政策、不含状态机判断
 * （报价状态流转、客户一致性、金额三件套口径均在 Business / Operation 层）。
 */

const quotationModel = (db: DbClient) => (db as typeof prisma).quotation;

export const quotationRepository = {
  findMany<T extends Prisma.QuotationFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QuotationGetPayload<T>[]> {
    return quotationModel(db).findMany(args as Prisma.QuotationFindManyArgs) as unknown as Promise<
      Prisma.QuotationGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.QuotationFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QuotationGetPayload<T> | null> {
    return quotationModel(db).findFirst(args as Prisma.QuotationFindFirstArgs) as unknown as Promise<
      Prisma.QuotationGetPayload<T> | null
    >;
  },

  count(where?: Prisma.QuotationWhereInput, db: DbClient = prisma): Promise<number> {
    return quotationModel(db).count(where ? { where } : undefined);
  },

  create<T extends Prisma.QuotationCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QuotationGetPayload<T>> {
    return quotationModel(db).create(args as Prisma.QuotationCreateArgs) as unknown as Promise<
      Prisma.QuotationGetPayload<T>
    >;
  },

  update<T extends Prisma.QuotationUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QuotationGetPayload<T>> {
    return quotationModel(db).update(args as Prisma.QuotationUpdateArgs) as unknown as Promise<
      Prisma.QuotationGetPayload<T>
    >;
  },

  delete<T extends Prisma.QuotationDeleteArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QuotationGetPayload<T>> {
    return quotationModel(db).delete(args as Prisma.QuotationDeleteArgs) as unknown as Promise<
      Prisma.QuotationGetPayload<T>
    >;
  },

  /** 同一商机的下一版号（version = max + 1；无报价时 1） */
  maxVersion(opportunityId: string, db: DbClient = prisma): Promise<number | null> {
    return quotationModel(db)
      .aggregate({ where: { opportunityId }, _max: { version: true } })
      .then((r) => r._max.version ?? null);
  },

  /**
   * （Round R-5 · Phase 4 · D3 审批域）多态审批引用读取：主键 + 业务编号。
   * 审批流水以 `bizType + businessId` 旁挂（无外键），需按 bizType 分派到各域仓储取数。
   */
  findRefById(id: string, db: DbClient = prisma) {
    return quotationModel(db).findUnique({ where: { id }, select: { id: true, quotationNo: true } });
  },

  /** 审批 Scope 白名单：当前用户可见的业务对象 id（scope 条件由调用方给出） */
  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return quotationModel(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.QuotationWhereInput,
      select: { id: true },
    });
  },

  /**
   * （Round R-5 · Phase 3）按商机 id 集合统计报价数 —— 商机阶段派生的信号来源。
   * 只取数据；「多少个报价算什么阶段」由 State 能力（state/pipelineStage.state）判定。
   */
  groupCountByOpportunityIds(ids: string[], db: DbClient = prisma) {
    return quotationModel(db).groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _count: { _all: true },
    });
  },

  /** 明细快照的可见产品批量读取（授权条件由调用方给出） */
  findVisibleProducts(
    productIds: string[],
    visibilityWhere: Prisma.ProductWhereInput = {},
    db: DbClient = prisma,
  ) {
    return db.product.findMany({
      where: { id: { in: productIds }, ...visibilityWhere },
      select: { id: true, name: true, sku: true, packaging: true },
    });
  },
};
