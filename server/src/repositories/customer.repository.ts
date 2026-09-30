import type { Prisma } from '@prisma/client';
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
  updateOwner(id: string, ownerId: string, db: DbClient = prisma) {
    return customerModel(db).update({ where: { id }, data: { ownerId } });
  },
};
