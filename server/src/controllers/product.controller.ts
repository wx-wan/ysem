import { Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const productSchema = z.object({
  name: z.string().min(1, '产品名称不能为空'),
  sku: z.string().optional(),
  craftIds: z.array(z.string().uuid()).optional(),
  audienceId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  // 产品属性
  images: z.string().optional(),
  sizeL: z.string().optional(),
  sizeW: z.string().optional(),
  sizeH: z.string().optional(),
  weight: z.string().optional(),
  unit: z.string().optional(),
  // 供货模式（单选，逗号分隔，最多一个值）
  supplyModes: z.string().optional(),
  // 认证资质：关联证书 id 列表（逗号分隔）
  certificationIds: z.string().optional(),
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
  // 产品进度（打样/报价阶段多子任务并行），前端维护的 JSON 字符串
  progress: z.string().optional(),
});

// 按「工艺代码 - 受众代码 - 序号」自动生成 SKU：
// 多工艺时主工艺在括号外，其余用 + 连接，如 TJ(ZS)-ET-001；序号按同组合递增 3 位补零。
// 缺少工艺或受众（含缺 code）时返回 null，由调用方决定提示。
async function buildSkuCode(
  craftIds: string[],
  audienceId: string | null,
  excludeId?: string,
): Promise<string | null> {
  if (!craftIds.length || !audienceId) return null;
  const crafts = await prisma.productCraft.findMany({ where: { id: { in: craftIds } } });
  const craftCodes = craftIds
    .map((id) => crafts.find((c) => c.id === id)?.code)
    .filter((c): c is string => Boolean(c));
  if (craftCodes.length !== craftIds.length) return null; // 有工艺未配置 code
  const audience = await prisma.productAudience.findUnique({ where: { id: audienceId } });
  if (!audience?.code) return null;

  const craftPart = craftCodes.length > 1
    ? `${craftCodes[0]}(${craftCodes.slice(1).join('+')})`
    : craftCodes[0];
  const prefix = `${craftPart}-${audience.code}-`;

  const existing = await prisma.product.findMany({
    where: { sku: { startsWith: prefix }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { sku: true },
  });
  let max = 0;
  for (const p of existing) {
    if (!p.sku) continue;
    const n = Number(p.sku.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// 预览接口：按当前工艺/受众返回下一个 SKU（不落库），供表单实时展示
export const previewProductSku = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const craftIds = (req.query.craftIds as string | undefined)?.split(',').filter(Boolean) ?? [];
    const audienceId = (req.query.audienceId as string | undefined) ?? null;
    const excludeId = (req.query.excludeId as string | undefined) ?? undefined;
    const sku = await buildSkuCode(craftIds, audienceId, excludeId);
    success(res, { sku });
  } catch { fail(res, 500, '服务器错误'); }
};

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
    const craftIds = (req.query.craftIds as string | undefined)?.split(',').filter(Boolean);
    const audienceId = req.query.audienceId as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (keyword) where.OR = [
      { name: { contains: keyword } },
      { sku: { contains: keyword } },
    ];
    if (craftIds?.length) where.crafts = { some: { id: { in: craftIds } } };
    if (audienceId) where.audienceId = audienceId;
    if (categoryId) where.categoryId = categoryId;
    if (status) where.status = status;

    const [list, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          crafts: { select: { id: true, name: true } },
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
        crafts: true,
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
    const parsed = productSchema.parse(req.body);
    const { craftIds, sku: _ignored, ...rest } = parsed;
    const data: Prisma.ProductCreateInput = { ...rest };
    if (craftIds?.length) data.crafts = { connect: craftIds.map((id) => ({ id })) };
    // SKU 无需人工录入：按「工艺-受众-序号」自动生成
    const hasFullContext = Boolean(craftIds?.length && parsed.audienceId);
    const sku = await buildSkuCode(craftIds ?? [], parsed.audienceId ?? null);
    if (hasFullContext && sku === null) {
      fail(res, 400, '工艺或受众缺少编码，请先在分类管理中补充代码');
      return;
    }
    data.sku = sku;
    const product = await prisma.product.create({ data });
    created(res, product);
  } catch (err) {
    if (err instanceof z.ZodError) { fail(res, 400, err.errors.map((e) => e.message).join(', ')); return; }
    fail(res, 500, '服务器错误');
  }
};

export const updateProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productSchema.partial().parse(req.body);
    const { craftIds, sku: _ignored, ...rest } = parsed;
    const data: Prisma.ProductUpdateInput = { ...rest };
    if (craftIds !== undefined) {
      data.crafts = craftIds?.length ? { set: craftIds.map((id) => ({ id })) } : { set: [] };
    }
    // 工艺或受众变化时，SKU 按新组合自动重新生成；未变化则保留原 SKU
    const existing = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { crafts: { select: { id: true } } },
    });
    if (existing) {
      const oldCraftIds = existing.crafts.map((c) => c.id).sort().join(',');
      const newCraftIds = craftIds === undefined ? null : [...craftIds].sort().join(',');
      const oldAudienceId = existing.audienceId ?? '';
      const newAudienceId = parsed.audienceId === undefined ? oldAudienceId : (parsed.audienceId ?? '');
      const craftsChanged = newCraftIds !== null && newCraftIds !== oldCraftIds;
      const audienceChanged = newAudienceId !== oldAudienceId;
      if (craftsChanged || audienceChanged) {
        const finalCraftIds = craftIds ?? existing.crafts.map((c) => c.id);
        const finalAudienceId = parsed.audienceId === undefined ? existing.audienceId : parsed.audienceId;
        const sku = await buildSkuCode(finalCraftIds, finalAudienceId, existing.id);
        if (sku === null && (finalCraftIds.length && finalAudienceId)) {
          fail(res, 400, '工艺或受众缺少编码，请先在分类管理中补充代码');
          return;
        }
        data.sku = sku;
      }
    }
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
