import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const unitSchema = z.object({
  name: z.string().trim().min(1, '单位名称不能为空').max(20, '单位名称最多 20 字符'),
  isActive: z.boolean().optional(),
  sort: z.number().int().optional(),
});

const sortSchema = z.array(
  z.object({
    id: z.string(),
    sort: z.number().int(),
  }),
);

// 启用的单位（用于下拉选择，如数量需求后缀）
export const getActiveUnits = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.unit.findMany({
      where: { isActive: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 全部单位（用于设置页管理）
export const getAllUnits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = (req.query.keyword as string | undefined)?.trim();
    const list = await prisma.unit.findMany({
      where: keyword ? { name: { contains: keyword } } : undefined,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getUnit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.unit.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '单位不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createUnit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = unitSchema.parse(req.body);
    const maxSort = await prisma.unit.aggregate({ _max: { sort: true } });
    const item = await prisma.unit.create({
      data: {
        name: data.name,
        isActive: data.isActive ?? true,
        sort: data.sort ?? (maxSort._max.sort ?? 0) + 1,
      },
    });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateUnit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = unitSchema.partial().parse(req.body);
    await prisma.unit.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteUnit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.unit.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 批量更新排序
export const updateUnitSort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = sortSchema.parse(req.body);
    await prisma.$transaction(
      items.map((item) =>
        prisma.unit.update({
          where: { id: item.id },
          data: { sort: item.sort },
        }),
      ),
    );
    success(res, null, '排序更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
