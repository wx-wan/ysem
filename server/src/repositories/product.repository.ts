import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { buildSkuCode } from '../lib/skuCode';
import type { DbClient } from './types';

/**
 * Product 数据访问
 *
 * - R-2 · Lead Pilot：Lead 流程实际需要的读取与归属/可见性联动写入
 * - **R-4 · Product Layering：迁移 Product 模块自身的 CRUD 与列表/详情读取**
 *
 * 所有「可见性」判定都由调用方传入 `visibilityWhere`（来自 scope.productVisibilityWhere），
 * 仓储不自行决定可见性政策。
 *
 * 不负责：业务规则、状态判断、HTTP、用户提示。
 */

/** 列表读取的关联 include（沿用既有投影，未增删字段） */
const LIST_INCLUDE = {
  crafts: { select: { productCraft: { select: { id: true, name: true } } } },
  audience: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  visibleUsers: { select: { userId: true } },
} as const;

/** 详情读取的关联 include（沿用既有投影，未增删字段） */
const DETAIL_INCLUDE = {
  crafts: { include: { productCraft: true } },
  audience: { include: { categories: true } },
  category: true,
  visibleUsers: { select: { userId: true } },
} as const;

/** 写入前授权复用的 include（既有 updateProduct 的 scoped findFirst 形态） */
const SCOPED_WRITE_INCLUDE = {
  crafts: { select: { productCraft: { select: { id: true, name: true } } } },
  visibleUsers: { select: { userId: true } },
} as const;

export const productRepository = {
  // ============================================================
  // R-2 · Lead Pilot（既有，未改动）
  // ============================================================

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

  // ============================================================
  // R-4 · Product Layering：列表 / 详情 / 下拉
  // ============================================================

  /** 下拉选项（可选产品：id + name + sku） */
  findOptions(visibilityWhere: Record<string, unknown>, db: DbClient = prisma) {
    return db.product.findMany({
      where: visibilityWhere,
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    });
  },

  /** 分页列表（关联 include 沿用既有形状） */
  findPage(
    where: Prisma.ProductWhereInput,
    skip: number,
    take: number,
    db: DbClient = prisma,
  ) {
    return db.product.findMany({
      where,
      include: LIST_INCLUDE,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
    });
  },

  countByWhere(where: Prisma.ProductWhereInput, db: DbClient = prisma) {
    return db.product.count({ where });
  },

  /** 详情（含工艺实体 / 受众及其品类 / 品类 / 可见人） */
  findDetail(id: string, db: DbClient = prisma) {
    return db.product.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  },

  /**
   * 详情读取的最小投影（「逻辑删除 / 简单存在性」校验用）。
   * 注意：getProductLogs 只用它做存在性判定，不参与可见性过滤（沿用既有语义）。
   */
  findIdById(id: string, db: DbClient = prisma) {
    return db.product.findUnique({ where: { id }, select: { id: true } });
  },

  /** 写入前 scoped 读取（id + 可见性；不可见与不存在同结果 → 404） */
  findScopedForWrite(
    id: string,
    visibilityWhere: Record<string, unknown>,
    db: DbClient = prisma,
  ) {
    return db.product.findFirst({
      where: { id, ...visibilityWhere },
      include: SCOPED_WRITE_INCLUDE,
    });
  },

  /** 无过滤读取（删除路径的「存在性 + 日志摘要」用，沿用既有语义） */
  findById(id: string, db: DbClient = prisma) {
    return db.product.findUnique({ where: { id } });
  },

  /** 混排列表的「产品」分支：不分页（分页在 Business 层合并后统一切分） */
  findManyForMixed(where: Prisma.ProductWhereInput, db: DbClient = prisma) {
    return db.product.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  },

  // ============================================================
  // R-4 · Product Layering：写入
  // ============================================================

  create(data: Prisma.ProductUncheckedCreateInput, db: DbClient = prisma) {
    return db.product.create({ data });
  },

  update(id: string, data: Prisma.ProductUpdateInput, db: DbClient = prisma) {
    return db.product.update({ where: { id }, data });
  },

  deleteById(id: string, db: DbClient = prisma) {
    return db.product.delete({ where: { id } });
  },

  /**
   * 下一个 SKU（只读推导，不落库）。
   *
   * 复用冻结的 SKU 契约 `lib/skuCode.buildSkuCode`（R-1 未迁移，格式与并发语义保持不变）：
   * 本方法只负责**提供数据客户端**，使 Operation / Business 层无需直接持有 prisma 单例。
   *
   * ⚠️ 写入路径必须传入事务客户端 `tx`（同一事务内先前创建、尚未提交的 Product 才可见）。
   */
  nextSku(
    craftIds: string[],
    audienceId: string | null,
    excludeId?: string,
    db: DbClient = prisma,
  ) {
    return buildSkuCode(db, craftIds, audienceId, excludeId);
  },
  /**
   * （Round R-5 · Phase 4 · D1-a 采购域）按对象级可见边界批量取产品 id。
   *
   * 采购明细的 Product 引用必须复用与销售域**同一**的 `productVisibilityWhere` 授权边界
   * （BC-8-5 / DQ-8-E）；「不存在」与「对 caller 不可见」同结果。
   */
  findIdsByVisibility(ids: string[], visibilityWhere: Prisma.ProductWhereInput = {}, db: DbClient = prisma) {
    return (db as typeof prisma).product.findMany({
      where: { id: { in: ids }, ...visibilityWhere },
      select: { id: true },
    });
  },

};
