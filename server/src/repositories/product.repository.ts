import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Product 数据访问（Round R-2 · Lead Pilot）
 *
 * 范围限制：本节**只提供 Lead 流程实际需要的读取与归属/可见性联动写入**，
 * 不迁移 Product 模块自身的 CRUD（属后续轮次），不重新设计 Product master。
 *
 * 所有「可见性」判定都由调用方传入 `visibilityWhere`（来自 utils/scope.productVisibilityWhere），
 * 仓储不自行决定可见性政策。
 */
export const productRepository = {
  /** 按 id + 调用方可见性取产品（引用侧校验：不可见与不存在同结果） */
  findVisibleById(id: string, visibilityWhere: Record<string, unknown>, db: DbClient = prisma) {
    return db.product.findFirst({
      where: { id, ...visibilityWhere },
      select: { name: true },
    });
  },

  /** 按 id 集合 + 可见性取 id（mutation 时刻重新授权，关闭 TOCTOU） */
  findVisibleIds(ids: string[], visibilityWhere: Record<string, unknown>, db: DbClient = prisma) {
    return db.product.findMany({
      where: { id: { in: ids }, ...visibilityWhere },
      select: { id: true },
    });
  },

  /** 按 id 集合 + 可见性取归属人（认领联动用） */
  findVisibleOwners(ids: string[], visibilityWhere: Record<string, unknown>, db: DbClient = prisma) {
    return db.product.findMany({
      where: { id: { in: ids }, ...visibilityWhere },
      select: { id: true, ownerId: true },
    });
  },

  /** 释放：置为公开并清空负责人 */
  releaseToPublic(ids: string[], db: DbClient = prisma) {
    return db.product.updateMany({
      where: { id: { in: ids } },
      data: { visibility: 'PUBLIC', ownerId: null },
    });
  },

  /** 认领：置负责人 */
  updateOwnerMany(ids: string[], ownerId: string, db: DbClient = prisma) {
    return db.product.updateMany({ where: { id: { in: ids } }, data: { ownerId } });
  },

  /** 转交：把目标用户加入私密产品可见人（联合唯一保证重复转交不产生重复行） */
  connectVisibleUser(productId: string, userId: string, db: DbClient = prisma) {
    return db.product.update({
      where: { id: productId },
      data: {
        visibleUsers: {
          connectOrCreate: {
            where: { productId_userId: { productId, userId } },
            create: { userId },
          },
        },
      },
    });
  },
};
