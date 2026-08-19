import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

// ============ 工艺 ProductCraft ============

const craftSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  code: z.string().trim().max(10, '编码最多 10 位').optional(),
  sort: z.number().int().optional(),
  status: z.number().int().optional(),
});

export const getCrafts = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.productCraft.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const createCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = craftSchema.parse(req.body);
    const item = await prisma.productCraft.create({ data });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = craftSchema.partial().parse(req.body);
    await prisma.productCraft.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.productCraft.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};

// ============ 受众 ProductAudience ============

const audienceSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  code: z.string().trim().max(10, '编码最多 10 位').optional(),
  sort: z.number().int().optional(),
  status: z.number().int().optional(),
});

export const getAudiences = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.productAudience.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { categories: { orderBy: { sort: 'asc' } } },
    });
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const createAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = audienceSchema.parse(req.body);
    const item = await prisma.productAudience.create({ data });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = audienceSchema.partial().parse(req.body);
    await prisma.productAudience.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const deleteAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.productAudience.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};

// ============ 品类 ProductCategory ============

const categorySchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  audienceId: z.string().min(1, '请选择所属受众'),
  sort: z.number().int().optional(),
  status: z.number().int().optional(),
});

export const getCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.productCategory.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      include: { audience: { select: { id: true, name: true } } },
    });
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = categorySchema.parse(req.body);
    const item = await prisma.productCategory.create({ data });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = categorySchema.partial().parse(req.body);
    await prisma.productCategory.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.productCategory.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};
