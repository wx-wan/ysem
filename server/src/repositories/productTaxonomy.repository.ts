import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Product 分类主数据（工艺 ProductCraft / 受众 ProductAudience / 品类 ProductCategory）数据访问
 * —— Round R-4 · Product Layering
 *
 * 归属：Product **master data** 的分类字典（不是业务流程数据）。
 * 与 `product.repository.ts`（Product 本体）分开两个文件，是因为二者的生命周期与维护入口不同：
 *   分类字典 → /product/taxonomy/* 维护；Product 本体 → /products/* 维护。
 *
 * 本仓储被三类调用方共用，故读取方法按「用途」而非「页面」切分：
 *   ① 分类管理页面（CRUD）
 *   ② Product 列表 / 详情的关联 include
 *   ③ Excel 导入与操作日志差异比对的「名称 ↔ id」解析
 *
 * 不负责：业务规则、权限政策、HTTP、用户提示。
 */
export const productTaxonomyRepository = {
  // ============================================================
  // 工艺 ProductCraft
  // ============================================================
  findCrafts(db: DbClient = prisma) {
    return db.productCraft.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  },

  createCraft(data: Prisma.ProductCraftUncheckedCreateInput, db: DbClient = prisma) {
    return db.productCraft.create({ data });
  },

  updateCraft(id: string, data: Prisma.ProductCraftUncheckedUpdateInput, db: DbClient = prisma) {
    return db.productCraft.update({ where: { id }, data });
  },

  deleteCraft(id: string, db: DbClient = prisma) {
    return db.productCraft.delete({ where: { id } });
  },

  /** 导入用：全部工艺的名称 → id 映射来源 */
  findCraftNameIdPairs(db: DbClient = prisma) {
    return db.productCraft.findMany({ select: { id: true, name: true } });
  },

  /** 差异比对用：按 id 集合取工艺名称 */
  findCraftNamesByIds(ids: string[], db: DbClient = prisma) {
    return db.productCraft.findMany({ where: { id: { in: ids } }, select: { name: true } });
  },

  // ============================================================
  // 受众 ProductAudience
  // ============================================================
  findAudiencesWithCategories(db: DbClient = prisma) {
    return db.productAudience.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { categories: { orderBy: { sort: 'asc' } } },
    });
  },

  createAudience(data: Prisma.ProductAudienceUncheckedCreateInput, db: DbClient = prisma) {
    return db.productAudience.create({ data });
  },

  updateAudience(id: string, data: Prisma.ProductAudienceUncheckedUpdateInput, db: DbClient = prisma) {
    return db.productAudience.update({ where: { id }, data });
  },

  deleteAudience(id: string, db: DbClient = prisma) {
    return db.productAudience.delete({ where: { id } });
  },

  findAudienceNameIdPairs(db: DbClient = prisma) {
    return db.productAudience.findMany({ select: { id: true, name: true } });
  },

  /** 差异比对用：按 id 取受众名称 */
  findAudienceNameById(id: string, db: DbClient = prisma) {
    return db.productAudience.findUnique({ where: { id }, select: { name: true } });
  },

  // ============================================================
  // 品类 ProductCategory
  // ============================================================
  findCategoriesWithAudience(db: DbClient = prisma) {
    return db.productCategory.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { audience: { select: { id: true, name: true } } },
    });
  },

  createCategory(data: Prisma.ProductCategoryUncheckedCreateInput, db: DbClient = prisma) {
    return db.productCategory.create({ data });
  },

  updateCategory(id: string, data: Prisma.ProductCategoryUncheckedUpdateInput, db: DbClient = prisma) {
    return db.productCategory.update({ where: { id }, data });
  },

  deleteCategory(id: string, db: DbClient = prisma) {
    return db.productCategory.delete({ where: { id } });
  },

  findCategoryNameIdPairs(db: DbClient = prisma) {
    return db.productCategory.findMany({ select: { id: true, name: true } });
  },

  /** 差异比对用：按 id 取品类名称 */
  findCategoryNameById(id: string, db: DbClient = prisma) {
    return db.productCategory.findUnique({ where: { id }, select: { name: true } });
  },
};
