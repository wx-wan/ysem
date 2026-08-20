import { Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';

const productSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().nullish(),
  craftIds: z.array(z.string().uuid()).nullish(),
  audienceId: z.string().uuid().nullish(),
  categoryId: z.string().uuid().nullish(),
  // 产品属性
  images: z.string().nullish(),
  sizeL: z.string().nullish(),
  sizeW: z.string().nullish(),
  sizeH: z.string().nullish(),
  weight: z.string().nullish(),
  unit: z.string().nullish(),
  // 供货模式（单选，逗号分隔，最多一个值）
  supplyModes: z.string().nullish(),
  // 认证资质：关联证书 id 列表（逗号分隔）
  certificationIds: z.string().nullish(),
  // 原有
  spec: z.string().nullish(),
  description: z.string().nullish(),
  price: z.number().nonnegative().nullish(),
  currency: z.string().nullish(),
  taxRate: z.number().min(0).max(100).nullish(),
  stock: z.number().int().min(0).nullish(),
  lowStockAlert: z.number().int().min(0).nullish(),
  source: z.string().nullish(),
  // 可见性：PUBLIC 所有人可见；PRIVATE 仅指定用户可见
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  visibleUserIds: z.array(z.string()).nullish(),
  remark: z.string().nullish(),
  // 产品进度（打样/报价阶段多子任务并行），前端维护的 JSON 字符串
  progress: z.string().nullish(),
});

// SKU 统一使用产品 id（cuid），不再按「工艺-受众-序号」自动生成。
export const getProductOptions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.product.findMany({
      select: { id: true, name: true, sku: true },
      orderBy: { name: 'asc' },
    });
    success(res, list);
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 10));
    const keyword = (req.query.keyword as string)?.trim() || '';
    const craftIds = (req.query.craftIds as string | undefined)?.split(',').filter(Boolean);
    const audienceId = req.query.audienceId as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;
    const visibility = req.query.visibility as string | undefined;

    const where: Record<string, unknown> = {};
    if (keyword) where.OR = [
      { name: { contains: keyword } },
      { sku: { contains: keyword } },
    ];
    if (craftIds?.length) where.crafts = { some: { id: { in: craftIds } } };
    if (audienceId) where.audienceId = audienceId;
    if (categoryId) where.categoryId = categoryId;
    if (visibility) where.visibility = visibility;

    // 可见性过滤：管理员可查看全部产品；其余用户仅见公开产品或自己可见的私密产品
    const uid = req.userId;
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (uid && !isAdmin) {
      where.OR = [
        { visibility: 'PUBLIC' },
        { AND: [{ visibility: 'PRIVATE' }, { createdBy: uid }] },
        { AND: [{ visibility: 'PRIVATE' }, { visibleUsers: { some: { userId: uid } } }] },
      ];
    }

    const [list, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          crafts: { select: { id: true, name: true } },
          audience: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
          visibleUsers: { select: { userId: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    success(res, { list, total, page, pageSize });
  } catch { fail(res, 500, '服务器错误'); }
};

export const getProductById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        crafts: true,
        audience: { include: { categories: true } },
        category: true,
        visibleUsers: { select: { userId: true } },
        activities: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    // 管理员可查看任意产品；其余用户仅创建人 + 指定可见人可查看私密产品
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (product.visibility === 'PRIVATE' && !isAdmin) {
      const uid = req.userId;
      const isCreator = product.createdBy === uid;
      const isVisibleUser = product.visibleUsers.some((v) => v.userId === uid);
      if (!isCreator && !isVisibleUser) {
        fail(res, 403, '无权查看该不公开产品');
        return;
      }
    }
    success(res, product);
  } catch { fail(res, 500, '服务器错误'); }
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productSchema.parse(req.body);
    const { craftIds, sku: _ignored, visibleUserIds, ...rest } = parsed;
    const data: Prisma.ProductCreateInput = { ...rest };
    data.createdBy = req.userId;
    if (craftIds?.length) data.crafts = { connect: craftIds.map((id) => ({ id })) };
    if (visibleUserIds?.length) {
      data.visibleUsers = { create: visibleUserIds.map((userId) => ({ userId })) };
    }
    // SKU 统一使用产品 id：创建后再回填
    const product = await prisma.product.create({ data });
    await prisma.product.update({ where: { id: product.id }, data: { sku: product.id } });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      action: 'CREATE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: JSON.stringify({ name: product.name, sku: product.sku }),
      productId: product.id,
    });
    created(res, product);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productSchema.partial().parse(req.body);
    const { craftIds, sku: _ignored, visibleUserIds, ...rest } = parsed;
    const data: Prisma.ProductUpdateInput = { ...rest };
    if (Array.isArray(craftIds)) {
      data.crafts = craftIds.length ? { set: craftIds.map((id) => ({ id })) } : { set: [] };
    }
    if (Array.isArray(visibleUserIds)) {
      data.visibleUsers = {
        deleteMany: {},
        create: visibleUserIds.map((userId) => ({ userId })),
      };
    }
    // 工艺或受众变化时，SKU 按新组合自动重新生成；未变化则保留原 SKU
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { visibleUsers: { select: { userId: true } } },
    });
    if (!existing) { fail(res, 404, '产品不存在'); return; }
    // SKU 统一使用产品 id：若历史数据未对齐则补全
    if (existing.sku !== existing.id) data.sku = existing.id;
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
    });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      action: 'UPDATE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: JSON.stringify({ name: product.name, sku: product.sku }),
      productId: product.id,
    });
    success(res, product, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const isAdmin = req.roleCode === 'admin' || req.roleCode === 'ADMIN';
    if (!isAdmin) {
      fail(res, 403, '仅管理员可删除产品');
      return;
    }
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    await prisma.product.delete({ where: { id: req.params.id } });
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      action: 'DELETE',
      module: 'product',
      targetId: product.id,
      target: product.name,
      detail: JSON.stringify({ name: product.name, sku: product.sku }),
      productId: product.id,
    });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};
