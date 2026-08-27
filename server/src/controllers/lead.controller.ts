import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { ownerScope, applyScope, roleScope } from '../utils/scope';
import { paginateList } from '../utils/query';
import { activityLogger } from '../lib/activity-logger';

const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: '新建',
  CONTACTED: '已联系',
  QUALIFIED: '已确认',
  INVALID: '无效',
  CONVERTED: '已转化',
  VALID: '有效',
};

const leadSchema = z.object({
  // 名称可选：未传时由系统按「渠道-平台-采购产品-数量」规则自动生成
  leadName: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  sourceChannel: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'INVALID', 'CONVERTED', 'VALID']).optional(),
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
  pipelineId: z.string().optional().nullable(), // 关联商机 ID（确认转商机后回填）
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

    let where: Record<string, unknown> = {};
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

    // 列表范围切换：mine=我的（assignedTo=当前用户）；pool=公海（assignedTo=null）
    const scope = req.query.scope as string;
    if (scope === 'mine' || scope === 'pool') {
      where.assignedTo = scope === 'mine' ? (req.userId ?? '') : null;
    } else if (assignedTo && (req.roleCode === 'admin' || req.roleCode === 'ADMIN')) {
      // 管理员可用 assignedTo 自由筛选；其余用户按角色 dataScope 过滤（含公海）
      where.assignedTo = assignedTo;
    } else {
      where = applyScope(where, await roleScope(req, { field: 'assignedTo' }));
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

    // 数据范围校验：管理员不受限；其余角色只能查看自己负责或公海的线索
    if (req.roleCode !== 'admin' && req.roleCode !== 'ADMIN') {
      if (item.assignedTo && item.assignedTo !== req.userId) {
        fail(res, 403, '无权查看该线索');
        return;
      }
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
    if (data.pipelineId === null) update.pipelineId = null;
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

// ========== 释放线索（私海 → 公海） ==========
export const releaseLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const username = req.username || '';
    const userId = req.userId || '';
    const roleCode = req.roleCode;
    const { id } = req.params;

    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    if (!lead.assignedTo) {
      fail(res, 400, '该线索已在公海');
      return;
    }
    if (lead.assignedTo !== userId && roleCode !== 'admin') {
      fail(res, 403, '无权释放该线索');
      return;
    }
    await prisma.lead.update({ where: { id }, data: { assignedTo: null } });
    await activityLogger.log({
      userId,
      username,
      realName: req.realName,
      action: 'RELEASE',
      module: 'lead',
      targetId: id,
      target: lead.leadName || lead.companyName || id,
      detail: `${username} 释放该线索到公海`,
      customerId: lead.customerId || undefined,
      productId: lead.productId || undefined,
    });
    success(res, null, '释放成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ========== 转交线索（联动客户 / 产品负责人） ==========
export const transferLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { newOwnerId } = z.object({ newOwnerId: z.string().min(1) }).parse(req.body);
    const username = req.username || '';
    const userId = req.userId || '';
    const roleCode = req.roleCode;

    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { assignedUser: { select: { id: true, realName: true } } },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    if (lead.assignedTo !== userId && roleCode !== 'admin') {
      fail(res, 403, '无权转交该线索');
      return;
    }
    const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!newOwner || newOwner.status !== 'ACTIVE') {
      fail(res, 400, '目标用户不存在或已停用');
      return;
    }
    const oldOwnerName = lead.assignedUser?.realName || '未分配';

    const updates: any[] = [prisma.lead.update({ where: { id }, data: { assignedTo: newOwnerId } })];
    if (lead.customerId) {
      updates.push(prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: newOwnerId } }));
    }
    if (lead.productId) {
      updates.push(prisma.singleProduct.update({ where: { id: lead.productId }, data: { ownerId: newOwnerId } }));
    }
    await prisma.$transaction(updates);

    await activityLogger.log({
      userId,
      username,
      realName: req.realName,
      action: 'TRANSFERRED',
      module: 'lead',
      targetId: id,
      target: lead.leadName || lead.companyName || id,
      detail: `${username} 将线索从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」`,
      customerId: lead.customerId || undefined,
      productId: lead.productId || undefined,
    });
    success(res, null, '转交成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 状态流转（如 转为已联系 / 已转化 / 无效 / 有效）
export const changeLeadStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = z.object({ status: z.enum(['NEW', 'CONTACTED', 'QUALIFIED', 'INVALID', 'CONVERTED', 'VALID']) }).parse(req.body);
    const existing = await prisma.lead.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      fail(res, 404, '线索不存在');
      return;
    }
    await prisma.lead.update({ where: { id: req.params.id }, data: { status } });

    const label = LEAD_STATUS_LABEL[status] || status;
    void activityLogger.log({
      userId: req.userId || '',
      username: req.username || '',
      realName: req.realName,
      action: 'STATUS',
      module: 'lead',
      targetId: existing.id,
      target: existing.leadName || existing.companyName || existing.id,
      detail: `将线索状态${existing.status ? `由「${LEAD_STATUS_LABEL[existing.status] || existing.status}」` : ''}变更为「${label}」`,
      customerId: existing.customerId || undefined,
      productId: existing.productId || undefined,
    });

    success(res, null, '状态已更新');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
