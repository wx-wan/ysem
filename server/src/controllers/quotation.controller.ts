import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

// ============ 校验 ============
const createSchema = z.object({
  opportunityId: z.string().min(1, '商机不能为空'),
  customerId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  title: z.string().min(1, '报价标题不能为空'),
  amount: z.number().positive('金额必须大于 0'),
  currency: z.string().optional().default('USD'),
  validUntil: z.string().optional().nullable(),
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED']).optional().default('DRAFT'),
  notes: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

// ============ 列表（按商机过滤） ============
export const listQuotations = async (req: AuthRequest, res: Response) => {
  try {
    const { opportunityId, customerId, status, page = 1, pageSize = 50 } = req.query as Record<string, any>;
    const where: Record<string, unknown> = {};
    if (opportunityId) where.opportunityId = opportunityId;
    if (customerId) where.customerId = customerId;
    if (status) where.status = status;

    const skip = (Number(page) - 1) * Number(pageSize);
    const list = await prisma.quotation.findMany({
      where,
      orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: Number(pageSize),
    });
    const total = await prisma.quotation.count({ where });
    return success(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (e: any) {
    return fail(res, 500, e?.message || '查询失败');
  }
};

// ============ 详情 ============
export const getQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.quotation.findUnique({
      where: { id: req.params.id },
    });
    if (!item) return fail(res, 404, '报价不存在');
    return success(res, item);
  } catch (e: any) {
    return fail(res, 500, e?.message || '查询失败');
  }
};

// ============ 新建（同一商机自动递增版本号） ============
export const createQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const body = createSchema.parse(req.body);
    const max = await prisma.quotation.aggregate({
      where: { opportunityId: body.opportunityId },
      _max: { version: true },
    });
    const version = (max._max.version ?? 0) + 1;
    const item = await prisma.quotation.create({
      data: {
        opportunityId: body.opportunityId,
        customerId: body.customerId ?? null,
        productId: body.productId ?? null,
        title: body.title,
        version,
        amount: body.amount,
        currency: body.currency ?? 'USD',
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
        status: body.status ?? 'DRAFT',
        notes: body.notes ?? null,
      },
    });
    return created(res, item);
  } catch (e: any) {
    if (e?.name === 'ZodError') return fail(res, 400, e.errors?.[0]?.message || '参数错误');
    return fail(res, 500, e?.message || '创建失败');
  }
};

// ============ 更新 ============
export const updateQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });
    const data: Record<string, unknown> = { ...rest };
    if (rest.validUntil !== undefined) data.validUntil = rest.validUntil ? new Date(rest.validUntil) : null;
    const item = await prisma.quotation.update({ where: { id }, data });
    return success(res, item);
  } catch (e: any) {
    if (e?.name === 'ZodError') return fail(res, 400, e.errors?.[0]?.message || '参数错误');
    return fail(res, 500, e?.message || '更新失败');
  }
};

// ============ 删除 ============
export const removeQuotation = async (req: AuthRequest, res: Response) => {
  try {
    await prisma.quotation.delete({ where: { id: req.params.id } });
    return success(res, null);
  } catch (e: any) {
    return fail(res, 500, e?.message || '删除失败');
  }
};
