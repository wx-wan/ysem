import type { Prisma } from '@prisma/client';
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
/** 当前 DbClient 上的 `user` 委托（兼容 prisma 单例与事务客户端） */
const model = (db: DbClient) => (db as typeof prisma).user;

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

  /**
   * （R-4 Product Layering 新增，**纯新增、不影响 Lead / Customer**）
   * Excel 导入用：「可见人员」展示名（realName / username）→ id 的解析来源。
   */
  findIdentityPairs(db: DbClient = prisma) {
    return db.user.findMany({ select: { id: true, realName: true, username: true } });
  },

  /**
   * （Round R-5 · Phase 1 新增，**纯新增、不影响 Lead / Customer / Product**）
   * 商机页「可分配用户」下拉：启用用户的基础展示字段。
   */
  findActiveBasicList(db: DbClient = prisma) {
    return db.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, realName: true, username: true },
    });
  },

  /** 差异比对用：按 id 集合取用户展示名 */
  findNamesByIds(ids: string[], db: DbClient = prisma) {
    return db.user.findMany({
      where: { id: { in: ids } },
      select: { realName: true, username: true },
    });
  },
  // ============================================================
  // Round R-5 · Phase 4 · D4-a2 账号与角色域：管理侧 CRUD
  // ============================================================
  // 说明：本段为**就地扩展**（遵守 D15），与既有的 Scope / 通知用查询共存。

  /** 管理侧用户列表（既有的固定 select 投影；`createdAt` 倒序 + 分页） */
  findManyForAdminList(
    where: Prisma.UserWhereInput,
    skip: number,
    take: number,
    db: DbClient = prisma,
  ) {
    return model(db).findMany({
      where,
      skip,
      take,
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        avatar: true, status: true, createdAt: true, lastLoginAt: true,
        role: { select: { id: true, name: true, code: true } },
        department: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  countWhere(where: Prisma.UserWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  /** 「选择指定人」轻量列表（排除 DISABLED；既有契约直接返回数组） */
  findForSelect(db: DbClient = prisma) {
    return model(db).findMany({
      where: { status: { not: 'DISABLED' } },
      select: { id: true, username: true, realName: true },
      orderBy: { createdAt: 'desc' },
    });
  },

  /** 管理侧详情（`role` / `department` 全字段） */
  findByIdWithRelations(id: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { id },
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        avatar: true, status: true, createdAt: true, lastLoginAt: true,
        role: true, department: true,
      },
    });
  },

  /** 删除保护判定所需的角色码（`admin` 账号受保护） */
  findByIdWithRole(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, include: { role: true } });
  },

  /** 密码重置需要读取既有 `lastLoginAt`（既有实现会在写回时原样带上） */
  findById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id } });
  },

  findIdByUsername(username: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { username }, select: { id: true } });
  },

  createForAdmin(data: Prisma.UserUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({
      data,
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        status: true, roleId: true, departmentId: true, createdAt: true,
      },
    });
  },

  updateForAdmin(id: string, data: Prisma.UserUncheckedUpdateInput, db: DbClient = prisma) {
    return model(db).update({
      where: { id },
      data,
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        status: true, roleId: true, departmentId: true,
      },
    });
  },

  delete(id: string, db: DbClient = prisma) {
    return model(db).delete({ where: { id } });
  },

  /** 某角色下的全部用户 id（权限/数据范围变更时的会话刷新广播对象） */
  findIdsByRoleId(roleId: string, db: DbClient = prisma) {
    return model(db).findMany({ where: { roleId }, select: { id: true } });
  },

  /** 密码写回（`lastLoginAt` 由 Business 按既有行为原样携带） */
  updatePassword(id: string, password: string, lastLoginAt: Date | null, db: DbClient = prisma) {
    return model(db).update({ where: { id }, data: { password, lastLoginAt } });
  },

  // ============================================================
  // Round R-5 · Phase 4 · D4-b 认证与会话域
  // ============================================================
  // 说明：以下方法的 select 与迁移前控制器内的查询**逐字段一致**，不扩大查询范围。

  /** 登录：按用户名取用户 + 角色 + 角色权限明细（密码 / 状态 / refreshTokens 均需） */
  findByUsernameWithAuthz(username: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { username },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
  },

  /** 登出：仅需 refreshTokens 列表 */
  findByIdWithRefreshTokens(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, refreshTokens: true } });
  },

  /** 刷新：需 username 以重建 payload */
  findByIdForRefresh(id: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { id },
      select: { id: true, username: true, refreshTokens: true },
    });
  },

  /** 改密：需既有密码哈希与新登录态清空目标 */
  findByIdWithPassword(id: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { id },
      select: { id: true, password: true, refreshTokens: true },
    });
  },

  /** 当前用户资料（含角色权限明细与部门） */
  findProfileById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({
      where: { id },
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        avatar: true, status: true, lastLoginAt: true, createdAt: true,
        role: { include: { permissions: { include: { permission: true } } } },
        department: true,
      },
    });
  },

  /** 登录成功：追加 refreshToken（多端在线，上限由 Business 裁剪）并记录最后登录时间 */
  setRefreshTokensAndLastLogin(
    id: string,
    refreshTokens: string[],
    lastLoginAt: Date,
    db: DbClient = prisma,
  ) {
    return model(db).update({
      where: { id },
      data: { refreshTokens: { set: refreshTokens }, lastLoginAt },
    });
  },

  /** 刷新轮换 / 登出：整体覆写 refreshTokens 列表 */
  setRefreshTokens(id: string, refreshTokens: string[], db: DbClient = prisma) {
    return model(db).update({ where: { id }, data: { refreshTokens: { set: refreshTokens } } });
  },

  /** 注册（公开注册入口）：密码由 Business 哈希后传入 */
  createFromRegister(
    data: { username: string; password: string; realName: string; email?: string; phone?: string },
    db: DbClient = prisma,
  ) {
    return model(db).create({
      data,
      select: { id: true, username: true, realName: true, email: true, createdAt: true },
    });
  },

  /** 改密：写入新哈希并清空全部端登录态（强制重新登录） */
  setPasswordAndClearTokens(id: string, password: string, db: DbClient = prisma) {
    return model(db).update({
      where: { id },
      data: { password, refreshTokens: { set: [] } },
    });
  },

};
