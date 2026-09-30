import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Department 数据访问 —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 归属：Data Layer。只做持久化与查询。
 *
 * 【注意】`include: { _count: { users: true } }` 为**既有 API 契约的一部分**
 * （列表 / 详情 / 树三个端点均携带该计数），不得删除。
 *
 * 组织树的**层级推导**（`scope/deptTree.ts` 的 `collectDepartmentIds` /
 * `getDepartmentScopeUserIds`）属 **Scope 能力**，被 `scope.ts` 消费，
 * 不在本轮范围（列为 Phase 6 归位审计项）。
 */
const model = (db: DbClient) => (db as typeof prisma).department;

const WITH_USER_COUNT = { _count: { select: { users: true } } } satisfies Prisma.DepartmentInclude;

export const departmentRepository = {
  /** 部门列表 / 部门树（两个端点共用同一查询；`sort` 升序） */
  findManyWithUserCount(db: DbClient = prisma) {
    return model(db).findMany({ include: WITH_USER_COUNT, orderBy: { sort: 'asc' } });
  },

  findByIdWithUserCount(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, include: WITH_USER_COUNT });
  },

  /** 编码唯一性检查（`code` 为唯一字段） */
  findByCode(code: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { code }, select: { id: true } });
  },

  create(data: Prisma.DepartmentCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  update(id: string, data: Prisma.DepartmentUpdateInput, db: DbClient = prisma) {
    return model(db).update({ where: { id }, data });
  },

  delete(id: string, db: DbClient = prisma) {
    return model(db).delete({ where: { id } });
  },
};
