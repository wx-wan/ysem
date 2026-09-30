import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Department Scope 数据访问 —— Round R-5 · T2（D-P6-A）
 *
 * 【为什么单独一个仓储】`src/scope/scope.ts` 是**被 repositories 依赖**的公共件
 * （多个仓储 import `applyScope`），而它又需要 DEPT 档位的「本部门及下级部门下的用户」数据。
 * 若让 `src/scope/deptTree.ts` 依赖 `user.repository`（后者 import scope），
 * 会形成 `scope → deptTree → user.repository → scope` 的循环依赖。
 *
 * 故本仓储**只做纯读取、绝不 import `src/scope/*`**，作为 Scope 能力专用数据出口：
 *
 *   scope/scope.ts → scope/deptTree.ts → repositories/departmentScope.repository.ts → lib/prisma
 *
 * 归属：Data Layer（只做持久化查询；父子树遍历算法在 `src/scope/deptTree.ts`）。
 */
const departmentModel = (db: DbClient) => (db as typeof prisma).department;
const userModel = (db: DbClient) => (db as typeof prisma).user;

export const departmentScopeRepository = {
  /**
   * 一次性加载全部部门的 `id / parentId`（供内存构建父子索引）。
   * 部门总量为个位数~几十量级，全量加载成本可忽略；**不得**逐层递归查库（N+1）。
   */
  findDeptParents(db: DbClient = prisma): Promise<Array<{ id: string; parentId: string | null }>> {
    return departmentModel(db).findMany({ select: { id: true, parentId: true } });
  },

  /** 取用户所属部门（未配置部门 → `departmentId` 为 null） */
  findUserDepartmentId(
    userId: string,
    db: DbClient = prisma,
  ): Promise<{ departmentId: string | null } | null> {
    return userModel(db).findUnique({ where: { id: userId }, select: { departmentId: true } });
  },

  /** 取指定部门集合下的全部用户 id */
  findUserIdsByDepartmentIds(
    departmentIds: string[],
    db: DbClient = prisma,
  ): Promise<Array<{ id: string }>> {
    if (departmentIds.length === 0) return Promise.resolve([]);
    return userModel(db).findMany({
      where: { departmentId: { in: departmentIds } } as Prisma.UserWhereInput,
      select: { id: true },
    });
  },
};
