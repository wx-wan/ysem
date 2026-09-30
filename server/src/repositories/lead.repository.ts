import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { paginateList, type PaginateOptions, type PaginateResult } from '../utils/query';
import type { DbClient } from './types';

/**
 * Lead 数据访问（Round R-2 · Lead Pilot）
 *
 * 归属：Data Layer。**只做数据访问**，不含任何业务判断
 * （「线索是否可以 Confirm」「是否应该创建 Customer」等均在 Business Layer）。
 *
 * 设计取舍：方法签名接受**明确的 Prisma 查询条件**（where / select / include / data），
 * 目的是让 R-2 能从既有 Controller 逐字搬迁既有查询、保证行为零变化；
 * 仓储内部不重新发明查询，也不做业务裁剪。
 *
 * `LeadItem` 与 `Lead` 属同一聚合（Lead 1:N LeadItem），其数据访问一并收在本仓储的
 * `items` 命名空间下，避免为子表单独建仓储。
 */

/**
 * 取 Lead 模型 delegate。
 *
 * 事务客户端（`Prisma.TransactionClient`）与全局单例（`PrismaClient`）的**模型 delegate
 * 形状完全一致**（`ITXClientDenyList` 只移除 `$connect` / `$transaction` 等连接与事务方法），
 * 因此这里统一收敛一次类型，使仓储方法的**返回类型可以按入参精确推导**（保留 Prisma 原有类型体验）。
 * 仓储内**不会**调用任何被移除的方法（不出现 `$transaction` / `$connect`）。
 */
const leadModel = (db: DbClient) => (db as typeof prisma).lead;

export const leadRepository = {
  // ============================================================
  // Lead
  // ============================================================

  /**
   * 来源不变量级联：客户来源（首次）确立后，其名下线索来源同步跟随。
   * 一个客户只有一种来源 —— 线索来源恒等于客户来源，故客户侧变更需回写其线索。
   */
  updateSourceByCustomerId(
    customerId: string,
    channelId: string | null,
    shopId: string | null,
    db: DbClient = prisma,
  ) {
    return db.lead.updateMany({
      where: { customerId },
      data: { channelId, shopId },
    });
  },

  /** 列表分页（复用既有 utils/query.paginateList，未引入第二套分页机制） */
  paginate<T = unknown>(
    where: Record<string, unknown>,
    options: PaginateOptions,
    db: DbClient = prisma,
  ): Promise<PaginateResult<T>> {
    return paginateList<T>(db.lead, where, options);
  },

  /**
   * 单条读取（scope 条件会注入非唯一条件，故一律 findFirst，沿用既有口径）。
   *
   * 泛型 + `LeadGetPayload<T>` 使**调用方**获得与直接调用 Prisma 一致的精确返回类型
   * （include / select 的推导不丢失）；Prisma 官方委托的类型无法在此透传，故内部收敛一次断言。
   */
  findFirst<T extends Prisma.LeadFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.LeadGetPayload<T> | null> {
    return leadModel(db).findFirst(args as Prisma.LeadFindFirstArgs) as unknown as Promise<
      Prisma.LeadGetPayload<T> | null
    >;
  },

  findUnique<T extends Prisma.LeadFindUniqueArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.LeadGetPayload<T> | null> {
    return leadModel(db).findUnique(args as Prisma.LeadFindUniqueArgs) as unknown as Promise<
      Prisma.LeadGetPayload<T> | null
    >;
  },

  create<T extends Prisma.LeadCreateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.LeadGetPayload<T>> {
    return leadModel(db).create(args as Prisma.LeadCreateArgs) as unknown as Promise<Prisma.LeadGetPayload<T>>;
  },

  update<T extends Prisma.LeadUpdateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.LeadGetPayload<T>> {
    return leadModel(db).update(args as Prisma.LeadUpdateArgs) as unknown as Promise<Prisma.LeadGetPayload<T>>;
  },

  delete<T extends Prisma.LeadDeleteArgs>(args: T, db: DbClient = prisma): Promise<Prisma.LeadGetPayload<T>> {
    return leadModel(db).delete(args as Prisma.LeadDeleteArgs) as unknown as Promise<Prisma.LeadGetPayload<T>>;
  },

  // ============================================================
  // LeadItem（同聚合子表）
  // ============================================================

  items: {
    /** 整组删除（编辑时「整组替换」语义） */
    deleteManyByLead(leadId: string, db: DbClient = prisma) {
      return db.leadItem.deleteMany({ where: { leadId } });
    },

    create(data: Prisma.LeadItemUncheckedCreateInput, db: DbClient = prisma) {
      return db.leadItem.create({ data });
    },

    /** 取该线索的第一条明细（既有语义：仅取首条做增量更新） */
    findFirstByLead(leadId: string, db: DbClient = prisma) {
      return db.leadItem.findFirst({ where: { leadId }, select: { id: true } });
    },

    updateById(id: string, data: Prisma.LeadItemUncheckedUpdateInput, db: DbClient = prisma) {
      return db.leadItem.update({ where: { id }, data });
    },
  },
};
