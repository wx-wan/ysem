import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const currencySchema = z.object({
  code: z.string().trim().min(1, '币种代码不能为空').max(10, '币种代码最多 10 字符'),
  name: z.string().trim().min(1, '币种名称不能为空').max(50, '币种名称最多 50 字符'),
  symbol: z.string().trim().max(10, '符号最多 10 字符').optional(),
  isActive: z.boolean().optional(),
  sort: z.number().int().optional(),
});

const sortSchema = z.array(
  z.object({
    id: z.string(),
    sort: z.number().int(),
  }),
);

// 启用的币种（用于下拉选择 + 顶部币种切换）
export const getActiveCurrencies = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.currencyRate.findMany({
      where: { isActive: true },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 全部币种（用于设置页管理）
export const getAllCurrencies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = (req.query.keyword as string | undefined)?.trim();
    const list = await prisma.currencyRate.findMany({
      where: keyword
        ? {
            OR: [
              { code: { contains: keyword } },
              { name: { contains: keyword } },
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

export const getCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.currencyRate.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '币种不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = currencySchema.parse(req.body);
    const maxSort = await prisma.currencyRate.aggregate({ _max: { sort: true } });
    const item = await prisma.currencyRate.create({
      data: {
        code: data.code,
        name: data.name,
        symbol: data.symbol ?? '',
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

export const updateCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = currencySchema.partial().parse(req.body);
    await prisma.currencyRate.update({ where: { id: req.params.id }, data });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.currencyRate.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 批量更新排序
export const updateCurrencySort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = sortSchema.parse(req.body);
    await prisma.$transaction(
      items.map((item) =>
        prisma.currencyRate.update({
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
