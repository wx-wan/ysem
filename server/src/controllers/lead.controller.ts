import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { ownerScope, applyScope, roleScope } from '../utils/scope';
import { paginateList } from '../utils/query';

const leadSchema = z.object({
  // 名称可选：未传时由系统按「渠道-平台-采购产品-数量」规则自动生成
  leadName: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  sourceChannel: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'INVALID', 'CONVERTED']).optional(),
  companyName: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(),
  contactMethod: z.string().trim().max(300).nullable().optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  productInterest: z.string().trim().max(300).nullable().optional(),
  productName: z.string().trim().max(200).nullable().optional(),
  remark: z.string().trim().max(1000).nullable().optional(),
  targetMarket: z.string().trim().max(200).nullable().optional(),
  productType: z.string().trim().max(200).nullable().optional(),
  productDesc: z.string().trim().max(2000).nullable().optional(),
  images: z.array(z.string().trim().max(500)).max(20).nullable().optional(),
  targetPrice: z.string().trim().max(200).nullable().optional(),
  certRequire: z.string().trim().max(1000).nullable().optional(),
  packageReq: z.string().trim().max(1000).nullable().optional(),
  deliveryReq: z.string().trim().max(1000).nullable().optional(),
  specialReq: z.string().trim().max(1000).nullable().optional(),
  customerType: z.string().trim().max(100).nullable().optional(),
  urgency: z.enum(['LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
  assignedTo: z.string().optional().nullable(),
});

// 列表：分页 + 多维筛选
export const getLeads = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const keyword = (req.query.keyword as string)?.trim();
    const channel = req.query.channel as string;   // 渠道（父级，如 国际站）
    const platform = req.query.platform as string; // 平台（子级，如 寿春店）
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
    // 来源渠道按「渠道 / 平台」两维筛选（sourceChannel 存渠道名或「渠道 / 平台」完整路径）
    if (channel && platform) {
      where.AND = [
        { sourceChannel: { contains: channel } },
        { sourceChannel: { contains: platform } },
      ];
    } else if (channel) {
      where.sourceChannel = { contains: channel };
    } else if (platform) {
      where.sourceChannel = { contains: platform };
    }
    if (status) where.status = status;
    if (source) where.source = source;

    // 数据范围：管理员可用 assignedTo 自由筛选；其余用户按角色 dataScope 过滤（含公海）
    if (assignedTo && (req.roleCode === 'admin' || req.roleCode === 'ADMIN')) {
      where.assignedTo = assignedTo;
    } else {
      applyScope(where, await roleScope(req, { field: 'assignedTo' }));
    }

    const { list, total, page: p, pageSize: ps } = await paginateList(
      prisma.lead,
      where,
      {
        page,
        pageSize,
        include: {
          customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true } },
          product: { select: { id: true, name: true } },
          assignedUser: { select: { id: true, username: true, realName: true } },
        },
      },
    );
    success(res, { list, total, page: p, pageSize: ps });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { customer: true, product: { select: { id: true, name: true } } },
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
    // 名称可选：未传时按「目标国家-产品名称」规则自动生成（修复 leadName 未定义导致创建必 500 的问题）
    const leadName = data.leadName ?? ([data.targetMarket, data.productName].filter(Boolean).join('-') || '未命名线索');
    const item = await prisma.lead.create({
      data: {
        leadName,
        customerId: data.customerId ?? null,
        sourceChannel: data.sourceChannel ?? null,
        productId: data.productId ?? null,
        quantity: data.quantity ?? 0,
        source: data.source ?? 'MANUAL',
        status: data.status ?? 'NEW',
        companyName: data.companyName ?? null,
        contactName: data.contactName ?? null,
        contactMethod: data.contactMethod ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        country: data.country ?? null,
        productInterest: data.productInterest ?? null,
      productName: data.productName ?? null,
        remark: data.remark ?? null,
        targetMarket: data.targetMarket ?? null,
        productType: data.productType ?? null,
        productDesc: data.productDesc ?? null,
        images:
          typeof data.images === 'string'
            ? data.images
            : Array.isArray(data.images)
            ? JSON.stringify(data.images)
              : null,
        targetPrice: data.targetPrice ?? null,
        certRequire: data.certRequire ?? null,
        packageReq: data.packageReq ?? null,
        deliveryReq: data.deliveryReq ?? null,
        specialReq: data.specialReq ?? null,
        customerType: data.customerType ?? null,
        urgency: data.urgency ?? null,
        assignedTo: data.assignedTo ?? null,
        createdBy: req.userId ?? null,
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
    if (data.companyName === null) update.companyName = null;
    if (data.sourceChannel === null) update.sourceChannel = null;
    if (data.productId === null) update.productId = null;
    if (data.productName === null) update.productName = null;
    if (data.assignedTo === null) update.assignedTo = null;
    if (data.images !== undefined) {
      update.images =
        data.images === null
          ? null
          : typeof data.images === 'string'
          ? data.images
          : JSON.stringify(data.images);
    }
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
