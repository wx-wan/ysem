import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const permissionSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(100),
  type: z.enum(['MENU', 'BUTTON', 'API']).optional().default('BUTTON'),
  parentId: z.string().nullable().optional(),
  sort: z.number().optional().default(0),
  path: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
});

// 获取权限列表
export const getPermissions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { sort: 'asc' },
    });
    success(res, permissions);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 获取权限树
export const getPermissionTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const permissions = await prisma.permission.findMany({
      orderBy: { sort: 'asc' },
    });
    success(res, permissions);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 创建权限
export const createPermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = permissionSchema.parse(req.body);
    const existing = await prisma.permission.findUnique({ where: { code: data.code } });
    if (existing) { fail(res, 409, '权限编码已存在'); return; }

    const permission = await prisma.permission.create({ data });
    created(res, permission, '权限创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 更新权限
export const updatePermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = permissionSchema.partial().parse(req.body);
    const permission = await prisma.permission.update({
      where: { id: req.params.id },
      data,
    });
    success(res, permission, '权限更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 删除权限
export const deletePermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.permission.delete({ where: { id: req.params.id } });
    success(res, null, '权限删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
