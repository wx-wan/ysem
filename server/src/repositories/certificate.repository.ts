import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Certificate（认证资质）数据访问 —— Round R-4 · Product Layering
 *
 * 范围限制：只提供 Product 流程实际需要的**只读**能力：
 *   · Excel 导入的「认证名称 → id」解析
 *   · 操作日志差异比对的「认证 id → 名称」解析
 * 不迁移 Certificate 模块自身的 CRUD（属后续轮次）。
 *
 * 不负责：业务规则、权限政策、HTTP。
 */
export const certificateRepository = {
  /** 导入用：全部认证的名称 → id 映射来源 */
  findNameIdPairs(db: DbClient = prisma) {
    return db.certificate.findMany({ select: { id: true, name: true } });
  },

  /** 差异比对用：按 id 集合取认证名称 */
  findNamesByIds(ids: string[], db: DbClient = prisma) {
    return db.certificate.findMany({ where: { id: { in: ids } }, select: { name: true } });
  },

  // ============================================================
  // Round R-5 · Phase 2：Certificate 属主访问（主数据 CRUD）
  // ============================================================

  /** 列表（不分页，证书数量有限；既有排序口径逐字沿用） */
  findAll(db: DbClient = prisma) {
    return db.certificate.findMany({ orderBy: [{ createdAt: 'asc' }] });
  },

  findById(id: string, db: DbClient = prisma) {
    return db.certificate.findUnique({ where: { id } });
  },

  create(data: Prisma.CertificateUncheckedCreateInput, db: DbClient = prisma) {
    return db.certificate.create({ data });
  },

  update(id: string, data: Prisma.CertificateUncheckedUpdateInput, db: DbClient = prisma) {
    return db.certificate.update({ where: { id }, data });
  },

  delete(id: string, db: DbClient = prisma) {
    return db.certificate.delete({ where: { id } });
  },
};
