import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Role / RolePermission 数据访问 —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 归属：Data Layer。只做持久化与查询；唯一性冲突与「admin 角色受保护」的**判定**在 Business。
 */
const model = (db: DbClient) => (db as typeof prisma).role;

export const roleRepository = {
  /** 角色列表（`_count.users` + 最近 5 名成员；`sort` 升序） */
  findManyWithCounts(db: DbClient = prisma) {
    return model(db).findMany({
      include: {
        _count: { select: { users: true } },
        users: {
          take: 5,
          select: { id: true, realName: true, avatar: true },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { sort: 'asc' },
    });
  },

  /** 角色详情（权限明细 + 用户计数） */
  findByIdWithPermissions(id: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  },

  findById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id } });
  },

  /** 编码唯一性检查（`code` 为唯一字段） */
  findByCode(code: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { code }, select: { id: true } });
  },

  create(data: Prisma.RoleCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  update(id: string, data: Prisma.RoleUpdateInput, db: DbClient = prisma) {
    return model(db).update({ where: { id }, data });
  },

  delete(id: string, db: DbClient = prisma) {
    return model(db).delete({ where: { id } });
  },

  // ============================================================
  // RolePermission（角色-权限关联）
  // ============================================================

  /** 清空某角色的全部权限关联 */
  deletePermissionsByRoleId(roleId: string, db: DbClient = prisma) {
    return (db as typeof prisma).rolePermission.deleteMany({ where: { roleId } });
  },

  /** 批量重建角色权限关联（空数组 = no-op，与既有 `createMany` 语义一致） */
  createPermissions(rows: Array<{ roleId: string; permissionId: string }>, db: DbClient = prisma) {
    return (db as typeof prisma).rolePermission.createMany({ data: rows });
  },
};
