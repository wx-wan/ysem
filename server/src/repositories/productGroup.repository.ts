import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * ComboProduct / ComboItem（产品组合）数据访问 —— Round R-4 · Product Layering
 *
 * 归属：Product 模块的**组合关系**（组合 ↔ 成员产品），与 Product 本体分文件。
 * 组合是产品主数据的「聚合关系」，不是独立主数据，因此不单列 Business 之外的模块边界。
 *
 * 不负责：业务规则（如「行内快速新建单品名称必填」「编号分配」）、权限政策、HTTP。
 */

/**
 * 成员产品关联 select —— **含内部授权字段**（visibility / createdBy / visibleUsers）。
 *
 * 这些字段只用于可见性判定，**必须**由调用方在响应前经 `utils/scope.projectProductRows` 投影剔除。
 * 组合列表 / 混排列表 / 组合详情三处原本各自复制了一份相同 select（含增补 `weight` 的变体），
 * 今收敛到此常量，避免再出现第四份。
 */
export const COMBO_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  sku: true,
  visibility: true,
  createdBy: true,
  visibleUsers: { select: { userId: true } },
} as const;

/** 组合明细写入形态（由调用方构造，仓储只负责落库） */
export interface ComboItemInput {
  productId?: string | null;
  quantity: number;
  price?: number | null;
  sort: number;
}

const ITEMS_INCLUDE = {
  items: {
    orderBy: { sort: 'asc' },
    include: { product: { select: COMBO_ITEM_PRODUCT_SELECT } },
  },
} as const;

export const productGroupRepository = {
  /** 分页列表（含成员产品简要信息） */
  findPageWithItems(
    where: Prisma.ComboProductWhereInput,
    skip: number,
    take: number,
    db: DbClient = prisma,
  ) {
    return db.comboProduct.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: ITEMS_INCLUDE,
    });
  },

  countByWhere(where: Prisma.ComboProductWhereInput, db: DbClient = prisma) {
    return db.comboProduct.count({ where });
  },

  /** 详情（成员产品额外带 weight，沿用既有差异） */
  findDetailById(id: string, db: DbClient = prisma) {
    return db.comboProduct.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: { sort: 'asc' },
          include: { product: { select: { ...COMBO_ITEM_PRODUCT_SELECT, weight: true } } },
        },
      },
    });
  },

  findRawById(id: string, db: DbClient = prisma) {
    return db.comboProduct.findUnique({ where: { id } });
  },

  /** 混排列表的「组合」分支：不分页（与原实现一致，分页在 Business 层合并后统一切分） */
  findManyWithItems(where: Prisma.ComboProductWhereInput, db: DbClient = prisma) {
    return db.comboProduct.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: ITEMS_INCLUDE,
    });
  },

  /**
   * 创建组合（含成员明细）。
   * 注意：`ownerId` 沿用既有语义（`req.userId || ''`，schema 上可空），不在此做业务校验。
   */
  createWithItems(
    input: {
      comboNo: string;
      name: string;
      description: string | null;
      ownerId: string;
      items: ComboItemInput[];
    },
    db: DbClient = prisma,
  ) {
    return db.comboProduct.create({
      data: {
        comboNo: input.comboNo,
        name: input.name,
        description: input.description,
        ownerId: input.ownerId,
        items: input.items.length
          ? {
              create: input.items.map((it) => ({
                productId: it.productId ?? undefined,
                quantity: it.quantity,
                price: it.price ?? null,
                sort: it.sort,
              })),
            }
          : undefined,
      },
      include: ITEMS_INCLUDE,
    });
  },

  updateBasics(id: string, data: { name?: string; description?: string | null }, db: DbClient = prisma) {
    return db.comboProduct.update({ where: { id }, data });
  },

  deleteById(id: string, db: DbClient = prisma) {
    return db.comboProduct.delete({ where: { id } });
  },

  /** 组合明细整组替换的第一步（与既有实现一致：先删后建，两步各自独立，非事务） */
  deleteItemsByComboId(comboId: string, db: DbClient = prisma) {
    return db.comboItem.deleteMany({ where: { comboId } });
  },

  /** 组合明细整组替换的第二步 */
  addItems(comboId: string, items: ComboItemInput[], db: DbClient = prisma) {
    return db.comboProduct.update({
      where: { id: comboId },
      data: {
        items: {
          create: items.map((it) => ({
            productId: it.productId ?? undefined,
            quantity: it.quantity,
            price: it.price ?? null,
            sort: it.sort,
          })),
        },
      },
      include: ITEMS_INCLUDE,
    });
  },
};
