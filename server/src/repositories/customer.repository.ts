import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Customer 数据访问（Round R-3 · Customer Pilot）
 *
 * 归属：Data Layer。**只做数据访问**，不含业务判断
 * （「客户是否可创建 / 可编辑 / 可认领」「intentLevel 如何派生」等均在 Business Layer）。
 *
 * 说明：
 *  - 本文件同时承载 R-2 为 Lead 流程建立的 customer 访问方法（`findScopedById` /
 *    `findOwnerById` / `findMutableForActor` / `releaseToPool` / `updateOwner`），
 *    方法签名与语义保持不变，Lead 侧零影响。
 *  - Customer 领域的查询形态差异极大（列表 / 统计 / 报表各自不同的 where 与聚合），
 *    因此通用读取保留 Prisma 精确入参（where / select / include / orderBy），
 *    由调用方（Operation / Business）提供**明确的数据查询条件**，仓储不自行决定业务规则。
 */

/**
 * 取 Customer 模型 delegate。
 * 事务客户端与全局单例的模型 delegate 形状完全一致（`ITXClientDenyList` 只移除
 * `$connect` / `$transaction` 等），因此统一收敛一次类型，使仓储方法保留 Prisma 原有返回类型体验。
 * 仓储内不会调用任何被移除的方法。
 */
const customerModel = (db: DbClient) => (db as typeof prisma).customer;

export const customerRepository = {
  // ============================================================
  // 通用读取 / 写入
  // ============================================================

  findMany<T extends Prisma.CustomerFindManyArgs>(args: T, db: DbClient = prisma): Promise<Prisma.CustomerGetPayload<T>[]> {
    return customerModel(db).findMany(args as Prisma.CustomerFindManyArgs) as unknown as Promise<
      Prisma.CustomerGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.CustomerFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.CustomerGetPayload<T> | null> {
    return customerModel(db).findFirst(args as Prisma.CustomerFindFirstArgs) as unknown as Promise<
      Prisma.CustomerGetPayload<T> | null
    >;
  },

  count(where?: Prisma.CustomerWhereInput, db: DbClient = prisma): Promise<number> {
    return customerModel(db).count(where ? { where } : undefined);
  },

  /**
   * 按标签关键词模糊匹配客户 id（大小写不敏感的子串匹配）。
   *
   * `Customer.tags` 为 PostgreSQL `text[]`，Prisma 的 `has` / `hasSome` 只支持元素**精确**匹配，
   * 无法表达「元素包含子串」；故此处用一条只取 id 的原生查询完成模糊匹配，
   * 调用方再把 id 列表并入常规 where ——数据范围 / 其它筛选 / 分页仍由 Prisma 查询负责。
   *
   * `limit` 为安全上限（匹配结果集过大时不至于拖垮查询）。
   */
  async findIdsByTagKeyword(keyword: string, limit = 5000): Promise<string[]> {
    // 转义 LIKE 通配符，避免用户输入的 % / _ 被当作模式
    const escaped = keyword.replace(/[\\%_]/g, (m) => `\\${m}`);
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "Customer"
      WHERE EXISTS (
        SELECT 1 FROM unnest("tags") AS t WHERE t ILIKE ${`%${escaped}%`}
      )
      LIMIT ${limit}
    `);
    return rows.map((r) => r.id);
  },

  create<T extends Prisma.CustomerCreateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.CustomerGetPayload<T>> {
    return customerModel(db).create(args as Prisma.CustomerCreateArgs) as unknown as Promise<
      Prisma.CustomerGetPayload<T>
    >;
  },

  update<T extends Prisma.CustomerUpdateArgs>(args: T, db: DbClient = prisma): Promise<Prisma.CustomerGetPayload<T>> {
    return customerModel(db).update(args as Prisma.CustomerUpdateArgs) as unknown as Promise<
      Prisma.CustomerGetPayload<T>
    >;
  },

  delete<T extends Prisma.CustomerDeleteArgs>(args: T, db: DbClient = prisma): Promise<Prisma.CustomerGetPayload<T>> {
    return customerModel(db).delete(args as Prisma.CustomerDeleteArgs) as unknown as Promise<
      Prisma.CustomerGetPayload<T>
    >;
  },

  /** 国家下拉数据源：distinct country（非空），保持既有 `distinct` 语义 */
  async distinctCountries(db: DbClient = prisma): Promise<string[]> {
    const rows = await customerModel(db).findMany({
      select: { country: true },
      where: { country: { not: null } },
      distinct: ['country'],
    });
    return rows.map((r) => r.country).filter((c): c is string => Boolean(c));
  },

  // ============================================================
  // Lead 流程专用（R-2 建立，语义与签名保持不变）
  // ============================================================

  /**
   * 按 id + 调用方数据范围取客户（不可见与不存在同结果）。
   * `ownerId` 供「归属可复用」门判定（线索只能关联本人负责或公海客户）—— 唯一调用点为 Lead 流程。
   */
  findScopedById(id: string, scope: Record<string, unknown>, db: DbClient = prisma) {
    return customerModel(db).findFirst({
      where: { ...(scope as Prisma.CustomerWhereInput), id },
      select: { id: true, ownerId: true },
    });
  },

  /** 按 id 取归属人（Lead 认领联动用：仅当客户无归属时才随线索认领） */
  findOwnerById(id: string, db: DbClient = prisma) {
    return customerModel(db).findUnique({ where: { id }, select: { ownerId: true } });
  },

  /** 「可联动修改」判定（授权条件直接表达在查询中；不以裸 findUnique 作为授权判据） */
  findMutableForActor(id: string, actorUserId: string, isAdmin: boolean, db: DbClient = prisma) {
    return customerModel(db).findFirst({
      where: isAdmin ? { id } : { id, ownerId: actorUserId },
      select: { id: true },
    });
  },

  /** 释放到公海（ownerId 置空 + 取消重点客户标记） */
  releaseToPool(id: string, db: DbClient = prisma) {
    return customerModel(db).update({ where: { id }, data: { ownerId: null, isKeyAccount: false } });
  },

  /** 改归属人 */
  /** 客户快照数据源（建档时一次性留痕）：客户本体字段 + 渠道 / 平台名称 */
  findSnapshotById(id: string, db: DbClient = prisma) {
    return db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        customerNo: true,
        companyName: true,
        contactName: true,
        contactMethods: true,
        email: true,
        phone: true,
        country: true,
        customerType: true,
        ownerId: true,
        channelId: true,
        shopId: true,
        channel: { select: { id: true, name: true } },
        shop: { select: { id: true, name: true } },
      },
    });
  },

  /** 来源渠道（来源不变量的判据：一个客户只有一种来源） */
  findChannelById(id: string, db: DbClient = prisma) {
    return db.customer.findUnique({
      where: { id },
      select: { channelId: true, shopId: true },
    });
  },

  /** 写入来源渠道：仅在客户**尚无来源**时由线索确立（既有来源不可被覆盖） */
  updateChannel(id: string, channelId: string | null, shopId: string | null, db: DbClient = prisma) {
    return db.customer.update({ where: { id }, data: { channelId, shopId } });
  },

  /**
   * 按 id 更新客户字段（线索侧「已关联客户 → 改名 / 改联系方式」专用）。
   * 语义：**修改同一条客户记录**，不做建档、不改编号、不改来源。
   */
  updateFields(id: string, data: Prisma.CustomerUpdateInput, db: DbClient = prisma) {
    return db.customer.update({ where: { id }, data });
  },

  updateOwner(id: string, ownerId: string, db: DbClient = prisma) {
    return customerModel(db).update({ where: { id }, data: { ownerId } });
  },
};
