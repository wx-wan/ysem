import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * User 数据访问（Round R-2 · Lead Pilot）
 *
 * 范围限制：只提供 Lead 流程实际需要的「归属人 / 目标转交人」校验读取，
 * 不迁移 User 模块 CRUD。
 *
 * 注意：数据范围（dataScope）条件的构造在调用方完成（`utils/scope.roleScope`），
 * 仓储只负责把条件合进查询，不决定权限政策。
 */
export const userRepository = {
  /** 按 id + 调用方数据范围取用户（「归属人不存在或无权限指派」判定） */
  findScopedById(id: string, scope: Record<string, unknown>, db: DbClient = prisma) {
    return db.user.findFirst({
      where: applyScope({ id }, scope),
      select: { id: true },
    });
  },

  /** 转交目标用户：需同时拿到 status（ACTIVE 校验）与展示名（日志摘要） */
  findScopedTransferTarget(id: string, scope: Record<string, unknown>, db: DbClient = prisma) {
    return db.user.findFirst({
      where: applyScope({ id }, scope),
      select: { id: true, status: true, username: true, realName: true },
    });
  },

  /**
   * （R-3 Customer Pilot 新增，**纯新增、不影响 Lead**）
   * 业务员列表及其客户分布（管理员客户页左栏）：排除 admin 角色，附客户数与重点客户数。
   */
  findActiveAssignees(db: DbClient = prisma) {
    return db.user.findMany({
      where: { status: 'ACTIVE', role: { code: { not: 'admin' } } },
      select: {
        id: true,
        username: true,
        realName: true,
        _count: { select: { ownedCustomers: true } },
        ownedCustomers: { where: { isKeyAccount: true }, select: { id: true } },
      },
    });
  },
};
