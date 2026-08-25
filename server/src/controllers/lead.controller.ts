import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const leadSchema = z.object({
  leadName: z.string().min(1, '线索名称不能为空'),
  customerId: z.string().optional().nullable(),
  channelId: z.string().optional().nullable(),
  shopId: z.string().optional().nullable(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'INVALID', 'CONVERTED']).optional(),
  companyName: z.string().trim().max(200).optional(),
  contactName: z.string().trim().max(100).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  country: z.string().trim().max(100).optional(),
  productInterest: z.string().trim().max(300).optional(),
  remark: z.string().trim().max(1000).optional(),
  assignedTo: z.string().optional().nullable(),
});

// 列表：分页 + 多维筛选
export const getLeads = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const keyword = (req.query.keyword as string)?.trim();
    const channelId = req.query.channelId as string; // 平台/展会
    const shopId = req.query.shopId as string; // 店铺
    const status = req.query.status as string;
    const source = req.query.source as string;
    const assignedTo = req.query.assignedTo as string;

    const where: Record<string, unknown> = {};
    if (keyword) {
      where.OR = [
        { leadName: { contains: keyword } },
        { companyName: { contains: keyword } },
        { contactName: { contains: keyword } },
        { email: { contains: keyword } },
        { phone: { contains: keyword } },
      ];
    }
    if (channelId) where.channelId = channelId;
    if (shopId) where.shopId = shopId;
    if (status) where.status = status;
    if (source) where.source = source;
    if (assignedTo) where.assignedTo = assignedTo;

    const [list, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        include: {
          customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true } },
          channel: { select: { id: true, name: true } },
          shop: { select: { id: true, name: true } },
        },
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.lead.count({ where }),
    ]);
    success(res, { list, total, page, pageSize });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        channel: { select: { id: true, name: true, category: true } },
        shop: { select: { id: true, name: true } },
      },
    });
    if (!item) {
      fail(res, 404, '线索不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = leadSchema.parse(req.body);
    const item = await prisma.lead.create({
      data: {
        leadName: data.leadName,
        customerId: data.customerId ?? null,
        channelId: data.channelId ?? null,
        shopId: data.shopId ?? null,
        source: data.source ?? 'MANUAL',
        status: data.status ?? 'NEW',
        companyName: data.companyName ?? null,
        contactName: data.contactName ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        productInterest: data.productInterest ?? null,
        remark: data.remark ?? null,
        assignedTo: data.assignedTo ?? null,
        createdBy: req.user?.userId ?? null,
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

export const updateLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = leadSchema.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.customerId === null) update.customerId = null;
    if (data.channelId === null) update.channelId = null;
    if (data.shopId === null) update.shopId = null;
    if (data.assignedTo === null) update.assignedTo = null;
    await prisma.lead.update({ where: { id: req.params.id }, data: update });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// 状态流转（如 转为已联系 / 已转化）
export const changeLeadStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = z.object({ status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'INVALID', 'CONVERTED']) }).parse(req.body);
    await prisma.lead.update({ where: { id: req.params.id }, data: { status } });
    success(res, null, '状态已更新');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
