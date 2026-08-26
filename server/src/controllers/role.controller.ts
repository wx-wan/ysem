import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { DEFAULT_DATA_SCOPE } from '../utils/scope';

const roleSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(50),
  description: z.string().optional().nullable(),
  sort: z.number().optional().default(0),
  dataScope: z.enum(['ALL', 'DEPT', 'SELF']).optional().default(DEFAULT_DATA_SCOPE),
});

// 获取角色列表
export const getRoles = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const roles = await prisma.role.findMany({
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
    success(res, roles);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 获取单个角色
export const getRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    if (!role) { fail(res, 404, '角色不存在'); return; }
    success(res, role);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 创建角色
export const createRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = roleSchema.parse(req.body);
    const existing = await prisma.role.findUnique({ where: { code: data.code } });
    if (existing) { fail(res, 409, '角色编码已存在'); return; }

    const role = await prisma.role.create({ data });
    created(res, role, '角色创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 更新角色
export const updateRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = roleSchema.partial().parse(req.body);
    const role = await prisma.role.update({ where: { id: req.params.id }, data });
    success(res, role, '角色更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 删除角色
export const deleteRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.role.delete({ where: { id: req.params.id } });
    success(res, null, '角色删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 分配权限
export const assignPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { permissionIds } = req.body as { permissionIds: string[] };
    if (!Array.isArray(permissionIds)) {
      fail(res, 400, '请提供权限ID数组');
      return;
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: req.params.id } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map(pid => ({ roleId: req.params.id, permissionId: pid })),
      }),
    ]);

    success(res, null, '权限分配成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
