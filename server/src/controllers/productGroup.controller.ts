import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';

const groupSchema = z.object({
  name: z.string().min(1, '产品组名称不能为空'),
  description: z.string().nullish(),
  productIds: z.array(z.string()).nullish(),
});

// 列表（含成员产品简要信息）
export const getProductGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const keyword = (req.query.keyword as string)?.trim() || '';

    const where: Record<string, unknown> = {};
    if (keyword) where.name = { contains: keyword };

    const [list, total] = await Promise.all([
      prisma.productGroup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.productGroup.count({ where }),
    ]);

    // 批量补充成员产品名称/SKU
    const groups = await Promise.all(
      list.map(async (g) => {
        const ids = (g.productIds || '').split(',').filter(Boolean);
        const products = ids.length
          ? await prisma.product.findMany({
              where: { id: { in: ids } },
              select: { id: true, name: true, sku: true, unit: true },
            })
          : [];
        return { ...g, productCount: products.length, products };
      }),
    );

    success(res, { list: groups, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getProductGroupById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const group = await prisma.productGroup.findUnique({ where: { id: req.params.id } });
    if (!group) {
      fail(res, 404, '产品组不存在');
      return;
    }
    const ids = (group.productIds || '').split(',').filter(Boolean);
    const products = ids.length
      ? await prisma.product.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, sku: true, unit: true, weight: true },
        })
      : [];
    success(res, { ...group, productCount: products.length, products });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = groupSchema.parse(req.body);
    const cleanIds = (parsed.productIds ?? []).filter(Boolean);
    const group = await prisma.productGroup.create({
      data: {
        name: parsed.name,
        description: parsed.description ?? null,
        productIds: cleanIds.join(','),
        ownerId: req.userId || '',
      },
    });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'product-group',
      targetId: group.id,
      target: group.name,
      detail: `创建了产品组「${group.name}」${cleanIds.length ? `（含 ${cleanIds.length} 个产品）` : ''}`,
    });
    created(res, group);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = groupSchema.partial().parse(req.body);
    const existing = await prisma.productGroup.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '产品组不存在');
      return;
    }
    const data: Record<string, unknown> = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.description !== undefined) data.description = parsed.description ?? null;
    if (parsed.productIds !== undefined) data.productIds = parsed.productIds.filter(Boolean).join(',');

    const group = await prisma.productGroup.update({ where: { id: req.params.id }, data });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'product-group',
      targetId: group.id,
      target: group.name,
      detail: `更新了产品组「${group.name}」`,
    });
    success(res, group);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.productGroup.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '产品组不存在');
      return;
    }
    await prisma.productGroup.delete({ where: { id: req.params.id } });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'DELETE',
      module: 'product-group',
      targetId: existing.id,
      target: existing.name,
      detail: `删除了产品组「${existing.name}」`,
    });
    success(res, { success: true });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 向产品组添加 / 移除产品
export const updateGroupProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z
      .object({ productIds: z.array(z.string()).min(1, '请至少提供一个产品 id') })
      .parse(req.body);
    const group = await prisma.productGroup.findUnique({ where: { id: req.params.id } });
    if (!group) {
      fail(res, 404, '产品组不存在');
      return;
    }
    const current = new Set((group.productIds || '').split(',').filter(Boolean));
    const mode = (req.query.mode as string) || 'add'; // add | remove
    if (mode === 'remove') {
      body.productIds.forEach((id) => current.delete(id));
    } else {
      body.productIds.forEach((id) => current.add(id));
    }
    const updated = await prisma.productGroup.update({
      where: { id: req.params.id },
      data: { productIds: [...current].join(',') },
    });
    success(res, updated);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
