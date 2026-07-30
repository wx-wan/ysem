import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const deptSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(50),
  parentId: z.string().nullable().optional(),
  leader: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  sort: z.number().optional().default(0),
  status: z.number().optional().default(1),
});

// 获取部门列表
export const getDepartments = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { sort: 'asc' },
    });
    success(res, departments);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 获取部门树
export const getDeptTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const departments = await prisma.department.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: { sort: 'asc' },
    });
    success(res, departments);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 获取单个部门
export const getDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const department = await prisma.department.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!department) { fail(res, 404, '部门不存在'); return; }
    success(res, department);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 创建部门
export const createDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = deptSchema.parse(req.body);
    const existing = await prisma.department.findUnique({ where: { code: data.code } });
    if (existing) { fail(res, 409, '部门编码已存在'); return; }

    const department = await prisma.department.create({ data });
    created(res, department, '部门创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 更新部门
export const updateDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = deptSchema.partial().parse(req.body);
    const department = await prisma.department.update({
      where: { id: req.params.id },
      data,
    });
    success(res, department, '部门更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 删除部门
export const deleteDepartment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.department.delete({ where: { id: req.params.id } });
    success(res, null, '部门删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
