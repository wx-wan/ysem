import { Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { pushNotification } from '../utils/notify';

const createUserSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(100),
  realName: z.string().min(1).max(50),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  roleId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  realName: z.string().min(1).max(50).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  avatar: z.string().optional().nullable(),
  status: z.enum(['ACTIVE', 'DISABLED', 'LOCKED']).optional(),
  roleId: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
});

// 获取用户列表
export const getUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { page = '1', pageSize = '10', keyword = '', status } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: Record<string, unknown> = {};
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { realName: { contains: keyword } },
        { email: { contains: keyword } },
      ];
    }
    if (status) where.status = status;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
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
      }),
      prisma.user.count({ where }),
    ]);

    success(res, { list: users, total, page: Number(page), pageSize: Number(pageSize) });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 轻量用户列表：仅返回 id/realName/username，供产品可见性等场景选择指定人。
// 不要求 system:user 权限，所有登录用户均可访问。
export const getUsersForSelect = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { status: { not: 'DISABLED' } },
      select: { id: true, username: true, realName: true },
      orderBy: { createdAt: 'desc' },
    });
    success(res, users);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 获取单个用户
export const getUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        avatar: true, status: true, createdAt: true, lastLoginAt: true,
        role: true, department: true,
      },
    });
    if (!user) { fail(res, 404, '用户不存在'); return; }
    success(res, user);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 创建用户
export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createUserSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { username: data.username } });
    if (existingUser) { fail(res, 409, '用户名已存在'); return; }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        username: data.username,
        password: hashedPassword,
        realName: data.realName,
        email: data.email,
        phone: data.phone,
        roleId: data.roleId,
        departmentId: data.departmentId,
        createdBy: req.userId,
      },
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        status: true, roleId: true, departmentId: true, createdAt: true,
      },
    });

    created(res, user, '用户创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 更新用户
export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateUserSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, username: true, realName: true, email: true, phone: true,
        status: true, roleId: true, departmentId: true,
      },
    });
    // 角色变更 → 通知该用户（及其新角色下其他成员）刷新权限会话
    if (data.roleId) {
      const affected = await prisma.user.findMany({ where: { roleId: data.roleId }, select: { id: true } });
      await Promise.all(
        affected.map((u) =>
          pushNotification({
            userId: u.id,
            type: 'PERM_CHANGED',
            title: '权限已变更',
            body: '您的角色或所属角色权限已更新',
            payload: { roleId: data.roleId },
          }),
        ),
      );
    }
    success(res, user, '用户更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 删除用户
export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, include: { role: true } });
    if (!target) {
      fail(res, 404, '用户不存在');
      return;
    }
    if (target.role?.code === 'admin') {
      fail(res, 400, '超级管理员账号不可删除');
      return;
    }
    await prisma.user.delete({ where: { id: req.params.id } });
    success(res, null, '用户删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 重置用户密码（有用户管理权限即可，原密码为 bcrypt 哈希不可逆，只能重置）
const resetPasswordSchema = z.object({
  password: z.string().min(6).max(100),
});

export const resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = resetPasswordSchema.parse(req.body);

    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '用户不存在'); return; }

    // 防止管理员误改自己（不影响功能，纯提示性约束交由前端，这里允许）
    const hashedPassword = await bcrypt.hash(data.password, 12);
    await prisma.user.update({
      where: { id: req.params.id },
      data: { password: hashedPassword, lastLoginAt: existing.lastLoginAt },
    });
    success(res, null, '密码重置成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
