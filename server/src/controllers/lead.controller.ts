import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { paginateList } from '../utils/query';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';

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
  ownerId: z.string().optional().nullable(),
  // V1.0：Lead 不再持有 pipelineId，商机关联由 Opportunity.leadId 单向持有（见 sales.controller）
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
    const ownerId = req.query.ownerId as string;

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

    // 列表范围切换：mine=我的（ownerId=当前用户）；pool=公海（ownerId=null）
    const scope = req.query.scope as string;
    if (scope === 'mine' || scope === 'pool') {
      where.ownerId = scope === 'mine' ? (req.userId ?? '') : null;
    } else if (ownerId && (req.roleCode === 'admin' || req.roleCode === 'ADMIN')) {
      // 管理员可用 ownerId 自由筛选；其余用户按角色 dataScope 过滤（含公海）
      where.ownerId = ownerId;
    } else {
      where = applyScope(where, await roleScope(req, { field: 'ownerId' }));
    }

    const { list, total, page: p, pageSize: ps } = await paginateList(
      prisma.lead,
      where,
      {
        page,
        pageSize,
        include: {
          customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true } },
          // V1.0：Lead 不再直挂 product，产品意向落在 Lead.items（LeadItem）上
          items: { include: { product: { select: { id: true, name: true } } } },
          owner: { select: { id: true, username: true, realName: true } },
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
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true } },
        // V1.0：Lead 不再直挂 product，产品意向落在 Lead.items（LeadItem）上
        items: { include: { product: { select: { id: true, name: true } } } },
        owner: { select: { id: true, username: true, realName: true } },
      },
    });
    if (!item) {
      fail(res, 404, '线索不存在');
      return;
    }

    // 数据范围校验：管理员不受限；其余角色只能查看自己负责或公海的线索
    if (req.roleCode !== 'admin' && req.roleCode !== 'ADMIN') {
      if (item.ownerId && item.ownerId !== req.userId) {
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

    // V1.0：Lead 的产品关联落在 LeadItem 上（Lead 1:N LeadItem），写入时带产品名快照
    let leadItems: { productId: string; productName: string | null; quantity: number }[] | undefined;
    if (data.productId) {
      const product = await prisma.product.findUnique({
        where: { id: data.productId },
        select: { name: true },
      });
      leadItems = [{
        productId: data.productId,
        productName: product?.name ?? data.productName ?? null,
        quantity: data.quantity || 1,
      }];
    }

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const leadNo = await getNextNumber(tx, 'LEAD');

      return tx.lead.create({
        data: {
          leadName,
          customerId: data.customerId ?? null,
          sourceChannel: data.sourceChannel ?? null,
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
          ownerId: data.ownerId ?? null,
          createdBy: req.userId ?? null,
          leadNo,
          ...(leadItems ? { items: { create: leadItems } } : {}),
        },
      });
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
    // V1.0：productId / productName 不再属于 Lead 标量，改由 LeadItem 承载
    const { productId, productName, ...leadData } = data;
    const update: Record<string, unknown> = { ...leadData };
    if (data.customerId === null) update.customerId = null;
    if (data.companyName === null) update.companyName = null;
    if (data.sourceChannel === null) update.sourceChannel = null;
    if (data.ownerId === null) update.ownerId = null;
    if (data.images !== undefined) {
      update.images =
        data.images === null
          ? null
          : typeof data.images === 'string'
          ? data.images
          : JSON.stringify(data.images);
    }
    await prisma.lead.update({ where: { id: req.params.id }, data: update });

    // V1.0：产品关联整表重建于 LeadItem（owner 为 leadId，不能误用 opportunityId）
    if (productId !== undefined) {
      await prisma.leadItem.deleteMany({ where: { leadId: req.params.id } });
      if (productId) {
        const product = await prisma.product.findUnique({
          where: { id: productId },
          select: { name: true },
        });
        await prisma.leadItem.create({
          data: {
            leadId: req.params.id,
            productId,
            productName: product?.name ?? productName ?? null,
            quantity: data.quantity || 1,
          },
        });
      }
    }
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

    // V1.0：产品通过 LeadItem 关联（Lead 1:N LeadItem）
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { items: { select: { productId: true } } },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    if (!lead.ownerId) {
      fail(res, 400, '该线索已在公海');
      return;
    }
    if (lead.ownerId !== userId && roleCode !== 'admin') {
      fail(res, 403, '无权释放该线索');
      return;
    }
    const updates: any[] = [prisma.lead.update({ where: { id }, data: { ownerId: null } })];
    // 联动释放客户到公海（ownerId 置空）
    if (lead.customerId) {
      updates.push(
        prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: null, isKeyAccount: false } }),
      );
    }
    // 联动产品释放：默认公开（visibility -> PUBLIC），并清空负责人
    const productIds = lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
    if (productIds.length) {
      updates.push(
        prisma.product.updateMany({
          where: { id: { in: productIds } },
          data: { visibility: 'PUBLIC', ownerId: null },
        }),
      );
    }
    await prisma.$transaction(updates);
    await activityLogger.log({
      userId,
      username,
      realName: req.realName,
      action: 'RELEASE',
      module: 'lead',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: id,
      businessNo: lead.leadNo,
      summary: `${username} 释放该线索到公海${lead.customerId ? '，并释放关联客户到公海' : ''}${productIds.length ? `，关联 ${productIds.length} 个产品置为公开` : ''}`,
      customerId: lead.customerId || undefined,
    });
    success(res, null, '释放成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ========== 认领线索（公海 → 私海） ==========
export const claimLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const username = req.username || '';
    const userId = req.userId || '';
    const { id } = req.params;

    // V1.0：产品通过 LeadItem 关联（Lead 1:N LeadItem）
    const lead = await prisma.lead.findUnique({
      where: { id },
      include: { items: { select: { productId: true } } },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    if (lead.ownerId) {
      fail(res, 400, '该线索已被认领');
      return;
    }

    const updates: any[] = [prisma.lead.update({ where: { id }, data: { ownerId: userId } })];
    // 联动认领客户：仅当客户仍在公海（无归属人）时才归属认领人，避免抢夺他人客户
    if (lead.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: lead.customerId },
        select: { ownerId: true },
      });
      if (customer && !customer.ownerId) {
        updates.push(prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: userId } }));
      }
    }
    // 联动认领产品：仅当产品无归属人时设为认领人
    const productIds = lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
    if (productIds.length) {
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, ownerId: true },
      });
      const freeIds = products.filter((p) => !p.ownerId).map((p) => p.id);
      if (freeIds.length) {
        updates.push(prisma.product.updateMany({ where: { id: { in: freeIds } }, data: { ownerId: userId } }));
      }
    }
    await prisma.$transaction(updates);
    await activityLogger.log({
      userId,
      username,
      realName: req.realName,
      action: 'CLAIM',
      module: 'lead',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: id,
      businessNo: lead.leadNo,
      summary: `${username} 认领了该线索`,
      customerId: lead.customerId || undefined,
    });
    success(res, null, '认领成功');
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
      include: {
        owner: { select: { id: true, realName: true } },
        // V1.0：产品通过 LeadItem 关联（Lead 1:N LeadItem）
        items: { include: { product: { select: { id: true, visibility: true } } } },
      },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    if (lead.ownerId !== userId && roleCode !== 'admin') {
      fail(res, 403, '无权转交该线索');
      return;
    }
    const newOwner = await prisma.user.findUnique({ where: { id: newOwnerId } });
    if (!newOwner || newOwner.status !== 'ACTIVE') {
      fail(res, 400, '目标用户不存在或已停用');
      return;
    }
    const oldOwnerName = lead.owner?.realName || '未分配';

    const updates: any[] = [prisma.lead.update({ where: { id }, data: { ownerId: newOwnerId } })];
    if (lead.customerId) {
      // 转移客户：负责人改为当前(目标)用户
      updates.push(prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: newOwnerId } }));
    }
    // 转移产品：私密(PRIVATE)则把目标用户加入可见人，公开(PUBLIC)保持
    // visibleUsers 是关联表（ProductVisibleUser）而非字符串数组，需用关系型写入；
    // 联合唯一 (productId, userId) 保证重复转交不会插入重复可见人
    const privateProductIds = lead.items
      .map((i) => i.product)
      .filter((p) => p && p.visibility === 'PRIVATE')
      .map((p) => p!.id);
    for (const productId of privateProductIds) {
      updates.push(
        prisma.product.update({
          where: { id: productId },
          data: {
            visibleUsers: {
              connectOrCreate: {
                where: { productId_userId: { productId, userId: newOwnerId } },
                create: { userId: newOwnerId },
              },
            },
          },
        }),
      );
    }
    await prisma.$transaction(updates);

    await activityLogger.log({
      userId,
      username,
      realName: req.realName,
      action: 'TRANSFERRED',
      module: 'lead',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: id,
      businessNo: lead.leadNo,
      summary: `${username} 将线索从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」${lead.customerId ? '，并转移关联客户' : ''}${privateProductIds.length ? `，关联 ${privateProductIds.length} 个私密产品加入可见人` : ''}`,
      customerId: lead.customerId || undefined,
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
      businessType: BUSINESS_TYPE.LEAD,
      businessId: existing.id,
      businessNo: existing.leadNo,
      summary: `将线索状态${existing.status ? `由「${LEAD_STATUS_LABEL[existing.status] || existing.status}」` : ''}变更为「${label}」`,
      customerId: existing.customerId || undefined,
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
