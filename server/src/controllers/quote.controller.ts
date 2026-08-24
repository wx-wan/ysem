import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';

// 创建报价单：可基于单个产品（targetType=PRODUCT）或产品组（targetType=GROUP）
const quoteSchema = z.object({
  title: z.string().min(1, '报价单标题不能为空'),
  targetType: z.enum(['PRODUCT', 'GROUP']).default('PRODUCT'),
  targetId: z.string().min(1, '目标 id 不能为空'),
  remark: z.string().nullish(),
  items: z.string().nullish(), // 报价明细 JSON 字符串（前端可编辑）
});

export const createQuote = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = quoteSchema.parse(req.body);

    // 解析关联产品：单品直接取；产品组展开其成员
    let productIds: string[] = [];
    let targetName = '';
    if (parsed.targetType === 'PRODUCT') {
      const p = await prisma.singleProduct.findUnique({ where: { id: parsed.targetId }, select: { id: true, name: true, sku: true } });
      if (!p) {
        fail(res, 404, '产品不存在');
        return;
      }
      productIds = [p.id];
      targetName = p.name;
    } else {
      const g = await prisma.comboProduct.findUnique({
        where: { id: parsed.targetId },
        select: { id: true, name: true, items: { select: { productId: true } } },
      });
      if (!g) {
        fail(res, 404, '组合不存在');
        return;
      }
      productIds = g.items.map((it) => it.productId).filter((x): x is string => Boolean(x));
      targetName = g.name;
    }

    const quote = await prisma.quote.create({
      data: {
        title: parsed.title,
        targetType: parsed.targetType,
        targetId: parsed.targetId,
        productIds: productIds.join(','),
        ownerId: req.userId || '',
        remark: parsed.remark ?? null,
        items: parsed.items ?? null,
        status: 'DRAFT',
      },
    });

    const label = parsed.targetType === 'PRODUCT' ? '产品' : '产品组';
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'CREATE',
      module: 'quote',
      targetId: parsed.targetId,
      target: targetName,
      detail: `基于${label}「${targetName}」创建了报价单「${parsed.title}」${productIds.length ? `（含 ${productIds.length} 个产品）` : ''}`,
    });

    created(res, quote);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 报价单列表（可按状态/目标类型过滤）
export const getQuotes = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
    const where: Record<string, unknown> = {};
    if (req.query.status) where.status = req.query.status;
    if (req.query.targetType) where.targetType = req.query.targetType;

    const [list, total] = await Promise.all([
      prisma.quote.findMany({
        where,
        include: {
          owner: { select: { id: true, realName: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.quote.count({ where }),
    ]);

    success(res, { list, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getQuoteById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!quote) {
      fail(res, 404, '报价单不存在');
      return;
    }
    const ids = (quote.productIds || '').split(',').filter(Boolean);
    const products = ids.length
      ? await prisma.singleProduct.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, sku: true, weight: true },
        })
      : [];
    success(res, { ...quote, products });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 更新报价单状态：SUBMITTED / APPROVED / REJECTED
export const updateQuoteStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = z.object({ status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']) }).parse(req.body);
    const existing = await prisma.quote.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '报价单不存在');
      return;
    }
    const updated = await prisma.quote.update({
      where: { id: req.params.id },
      data: { status: body.status },
    });
    const statusLabel: Record<string, string> = { SUBMITTED: '已提交', APPROVED: '已通过', REJECTED: '已驳回' };
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'quote',
      targetId: existing.targetId,
      target: existing.title,
      detail: `将报价单「${existing.title}」状态更新为「${statusLabel[body.status]}」`,
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
