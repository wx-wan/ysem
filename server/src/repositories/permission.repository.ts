import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Permission 数据访问 —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 归属：Data Layer。只做持久化与查询；唯一性冲突的**判定**在 Business
 * （仓储只提供 `findByCode` 查询能力，不决定 HTTP 语义）。
 */
const model = (db: DbClient) => (db as typeof prisma).permission;

export const permissionRepository = {
  /** 权限列表（`sort` 升序；既有契约直接返回数组） */
  findMany(db: DbClient = prisma) {
    return model(db).findMany({ orderBy: { sort: 'asc' } });
  },

  /** 权限树数据源（`sort` 升序，`id` 作确定性并列键） */
  findManyForTree(db: DbClient = prisma) {
    return model(db).findMany({ orderBy: [{ sort: 'asc' }, { id: 'asc' }] });
  },

  /** 编码唯一性检查（`code` 为唯一字段） */
  findByCode(code: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { code }, select: { id: true } });
  },

  create(data: Prisma.PermissionCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  update(id: string, data: Prisma.PermissionUpdateInput, db: DbClient = prisma) {
    return model(db).update({ where: { id }, data });
  },

  delete(id: string, db: DbClient = prisma) {
    return model(db).delete({ where: { id } });
  },
};
