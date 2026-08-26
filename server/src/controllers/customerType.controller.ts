import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const customerTypeSchema = z.object({
  name: z.string().min(1, '名称不能为空').max(50, '名称最多 50 字符'),
  description: z.string().max(200, '说明最多 200 字符').optional(),
  isActive: z.boolean().optional(),
  sort: z.number().int().optional(),
});

const sortSchema = z.array(
  z.object({
    id: z.string(),
    sort: z.number().int(),
  }),
);

// 启用的客户类型（用于下拉选择）
export const getActiveCustomerTypes = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.customerType.findMany({
      where: { isActive: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 全部客户类型（用于设置页管理）
export const getAllCustomerTypes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = (req.query.keyword as string | undefined)?.trim();
    const list = await prisma.customerType.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { description: { contains: keyword } },
            ],
          }
        : undefined,
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getCustomerType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.customerType.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '客户类型不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createCustomerType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = customerTypeSchema.parse(req.body);
    const maxSort = await prisma.customerType.aggregate({ _max: { sort: true } });
    const item = await prisma.customerType.create({
      data: {
        name: data.name,
        description: data.description ?? null,
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

export const updateCustomerType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = customerTypeSchema.partial().parse(req.body);
    await prisma.customerType.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCustomerType = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.customerType.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 批量更新排序
export const updateCustomerTypeSort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = sortSchema.parse(req.body);
    await prisma.$transaction(
      items.map((item) =>
        prisma.customerType.update({
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
