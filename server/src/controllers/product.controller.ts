import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const productSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().optional(),
  craftId: z.string().uuid().nullable().optional(),
  audienceId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  // 产品属性
  images: z.string().optional(),
  sizeL: z.string().optional(),
  sizeW: z.string().optional(),
  sizeH: z.string().optional(),
  weight: z.string().optional(),
  unit: z.string().optional(),
  // 产品要求
  sampleNo: z.string().optional(),
  logo: z.boolean().optional(),
  sound: z.boolean().optional(),
  glow: z.boolean().optional(),
  colorChange: z.boolean().optional(),
  sprayWater: z.boolean().optional(),
  colors: z.string().optional(),
  colorImage: z.string().optional(),
  packaging: z.string().optional(),
  // 供货模式
  supplyModes: z.string().default(''),
  // 原有
  spec: z.string().optional(),
  description: z.string().optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  taxRate: z.number().min(0).max(100).optional(),
  stock: z.number().int().min(0).optional(),
  lowStockAlert: z.number().int().min(0).optional(),
  source: z.string().optional(),
  status: z.string().optional(),
  remark: z.string().optional(),
});

export const getProductOptions = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
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
    const craftId = req.query.craftId as string | undefined;
    const audienceId = req.query.audienceId as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (keyword) where.OR = [
      { name: { contains: keyword } },
      { sku: { contains: keyword } },
      { sampleNo: { contains: keyword } },
    ];
    if (craftId) where.craftId = craftId;
    if (audienceId) where.audienceId = audienceId;
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status;

    const [list, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          craft: { select: { id: true, name: true } },
          audience: { select: { id: true, name: true } },
          category: { select: { id: true, name: true } },
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
        craft: true,
        audience: { include: { categories: true } },
        category: true,
      },
    });
    if (!product) { fail(res, 404, '产品不存在'); return; }
    success(res, product);
  } catch { fail(res, 500, '服务器错误'); }
};

export const createProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({ data });
    created(res, product);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
    });
    success(res, product, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};
