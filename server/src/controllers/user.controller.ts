import { Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

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
    await prisma.user.delete({ where: { id: req.params.id } });
    success(res, null, '用户删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
