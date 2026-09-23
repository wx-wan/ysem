import { Response } from 'express';
import { z } from 'zod';
import { LeadStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope, includePublicSea, productVisibilityWhere, projectProductRows } from '../utils/scope';
import { paginateList } from '../utils/query';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';

const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: '新建',
  CONTACTED: '已联系',
  QUALIFIED: '已确认',
  INVALID: '无效',
  CONVERTED: '已转化',
};

const leadSchema = z.object({
  // 名称可选：未传时由系统按「渠道-平台-采购产品-数量」规则自动生成
  leadName: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  // F-8L-A：来源渠道 / 来源平台正式字段（Lead.channelId / Lead.shopId，均 → Channel）
  channelId: z.string().optional().nullable(),
  shopId: z.string().optional().nullable(),
  sourceChannel: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  // V1.0：与 Prisma LeadStatus 严格一致（NEW / CONTACTED / QUALIFIED / CONVERTED / INVALID）
  status: z.nativeEnum(LeadStatus).optional(),
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

/**
 * V1.0 Lead 可写标量白名单：与 Prisma Lead 模型逐字段一致。
 *
 * 以下 legacy 入参仍被 leadSchema 接受（保持 API 兼容，不返回 400），但**不落库**
 * —— V1.0 Lead 无对应列：
 *   - sourceChannel  → V1.0 已改为 channelId / shopId 关联（F-8L-A 落库）；此处仍接受但不落库，避免历史前端 400
 *   - productType / productDesc → V1.0 无对应列；产品信息经 LeadItem.productName 承载（本 Round 不处理）
 *   - images         → V1.0 图片走 Attachment(ownerType=LEAD)（本 Round 不处理）
 * 正式落库字段 channelId / shopId 已加入下方白名单（F-8L-A）。
 */
const LEAD_WRITABLE_FIELDS = [
  'leadName',
  'customerId',
  'channelId',
  'shopId',
  'source',
  'status',
  'companyName',
  'contactName',
  'contactMethod',
  'email',
  'phone',
  'country',
  'customerType',
  'productInterest',
  'quantity',
  'targetPrice',
  'certRequire',
  'packageReq',
  'deliveryReq',
  'targetMarket',
  'specialReq',
  'remark',
  'ownerId',
] as const;

/**
 * LeadItem 关联产品的公开字段（DQ-3=C 投影白名单）。
 * `visibility` / `createdBy` / `visibleUsers` 为**内部授权字段**，只用于可见性判定，不得进入响应。
 */
const LEAD_ITEM_PRODUCT_FIELDS = ['id', 'name'] as const;

/** LeadItem 关联产品的读取侧 include（含内部授权字段，响应前必须经 projectProductRows 投影） */
const LEAD_ITEM_PRODUCT_SELECT = {
  id: true,
  name: true,
  visibility: true,
  createdBy: true,
  visibleUsers: { select: { userId: true } },
} as const;

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有线索单条读写都必须经此条件，杜绝越权访问。
 * Lead 有直接 ownerId（非经关联继承），故不传 relation；本条件**不并入公海**（DQ-1=A1）。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId' }));
}

/**
 * F-8L-A · Lead 来源渠道/来源平台契约校验（create / update 共用）。
 *
 * 现系统对 Channel / Shop **没有** per-user permission / ownership / visibility 机制
 * （Channel 属全局主数据，无 ownerId、无 visibility；scope 工具仅覆盖 ownerId 资源与
 * Product 对象级可见性，见 utils/scope.ts）。故本校验**仅**做：
 *   1) 引用存在性：传入的 channelId / shopId 必须是 ACTIVE 的 Channel（可空，不强制必填）；
 *   2) 硬业务规则：当 channelId 与 shopId **同时非空**时，必须满足 `shop.parentId === channelId`。
 * 不发明第二套 Channel 权限体系（遵循 D3 / 第 5 节约束）。存在性校验先于任何写入，
 * 不可见与不存在同结果（400），避免引入存在性 oracle。
 *
 * @returns false 时已通过 fail(res,...) 写入错误响应，调用方须 return。
 */
async function validateChannelShop(
  res: Response,
  channelId: string | null | undefined,
  shopId: string | null | undefined,
): Promise<boolean> {
  if (channelId !== undefined && channelId !== null) {
    const ch = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { id: true, status: true },
    });
    if (!ch || ch.status !== 'ACTIVE') {
      fail(res, 400, '来源渠道不存在');
      return false;
    }
  }
  if (shopId !== undefined && shopId !== null) {
    const shop = await prisma.channel.findUnique({
      where: { id: shopId },
      select: { id: true, parentId: true, status: true },
    });
    if (!shop || shop.status !== 'ACTIVE') {
      fail(res, 400, '来源平台不存在');
      return false;
    }
    // 硬规则：仅当两者均非空时校验父子一致性（channelId 为空则跳过，遵循冻结契约）
    if (channelId !== undefined && channelId !== null && shop.parentId !== channelId) {
      fail(res, 400, '来源平台不属于所选来源渠道');
      return false;
    }
  }
  return true;
}

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
          items: { include: { product: { select: LEAD_ITEM_PRODUCT_SELECT } } },
          owner: { select: { id: true, username: true, realName: true } },
          // F-8L-A：来源渠道 / 来源平台关系（仅投影 id + name，剔除无关字段）
          channel: { select: { id: true, name: true } },
          shop: { select: { id: true, name: true } },
        },
        },
        );
        // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
        const safeList = (list as { items: Record<string, unknown>[] }[]).map((lead) => ({
          ...lead,
          items: projectProductRows(req, lead.items, LEAD_ITEM_PRODUCT_FIELDS, { nameField: 'productName' }),
        }));
        success(res, { list: safeList, total, page: p, pageSize: ps });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 数据范围：目标线索本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    // scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
    const item = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: {
        customer: { select: { id: true, companyName: true, contactName: true, email: true, phone: true, country: true } },
        // V1.0：Lead 不再直挂 product，产品意向落在 Lead.items（LeadItem）上
        items: { include: { product: { select: LEAD_ITEM_PRODUCT_SELECT } } },
        owner: { select: { id: true, username: true, realName: true } },
        // F-8L-A：来源渠道 / 来源平台关系（仅投影 id + name，剔除无关字段）
        channel: { select: { id: true, name: true } },
        shop: { select: { id: true, name: true } },
      },
    });
    if (!item) {
      fail(res, 404, '线索不存在');
      return;
    }

    // 读取侧（DQ-3=C）：不可见 PRIVATE 产品的属性不得进入响应
    success(res, {
      ...item,
      items: projectProductRows(req, item.items, LEAD_ITEM_PRODUCT_FIELDS, { nameField: 'productName' }),
    });
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
      // 引用侧（DQ-3=C）：产品引用必须落在 caller 可见范围内；**先于事务与任何写入**。
      // 不可见与不存在**同结果**（400 `产品不存在`），不引入存在性 oracle。
      const product = await prisma.product.findFirst({
        where: { id: data.productId, ...productVisibilityWhere(req) },
        select: { name: true },
      });
      if (!product) {
        fail(res, 400, '产品不存在');
        return;
      }
      leadItems = [{
        productId: data.productId,
        productName: product.name,
        quantity: data.quantity || 1,
      }];
    }

    // P5-OWN-01（F-NEW-01）：显式指定业务归属人时必须落在当前用户数据范围内，
    // 且**先于事务与任何写入**（形态与 quotation / salesOrder / productionOrder / sampleOrder 一致）。
    // Lead 的 `ownerId` 缺省或显式 null 表示**公海**（DQ-1=A1），故仅在传入具体用户时校验。
    if (data.ownerId !== undefined && data.ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: applyScope({ id: data.ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true },
      });
      if (!owner) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }

    // BC-8-3（DQ-8-B B1）：`customerId` 属**引用**，必须解析于 caller 的 Customer 可见范围
    // （owner ∪ 公海 ∪ admin/ALL）；不可见与不存在同结果（400 `客户不存在`），不泄露存在性。
    // 不引入 `Lead.ownerId == Customer.ownerId` 约束（未冻结）。先于事务与任何写入。
    if (data.customerId !== undefined && data.customerId !== null) {
      const customer = await prisma.customer.findFirst({
        where: applyScope({ id: data.customerId }, includePublicSea(await roleScope(req))),
        select: { id: true },
      });
      if (!customer) {
        fail(res, 400, '客户不存在');
        return;
      }
    }

    // F-8L-A · 来源渠道/来源平台：引用存在性 + 父子一致性（shop.parentId === channelId）。
    // 仅校验引用合法性，不发明 Channel/Shop 的 per-user 权限（系统无此机制，Channel 为全局主数据）。
    // 先于事务与任何写入（与 customerId / productId / ownerId 同口径）。
    if (!(await validateChannelShop(res, data.channelId, data.shopId))) return;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const leadNo = await getNextNumber(tx, 'LEAD');

      return tx.lead.create({
        data: {
          leadName,
          customerId: data.customerId ?? null,
          channelId: data.channelId ?? null,
          shopId: data.shopId ?? null,
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
    // V1.0：只写入与 Prisma Lead 标量一致的字段（legacy sourceChannel / productType /
    // productDesc / images 被接受但不落库，见 LEAD_WRITABLE_FIELDS；null 亦会透传以支持清空）
    const update: Record<string, unknown> = {};
    for (const field of LEAD_WRITABLE_FIELDS) {
      if (leadData[field] !== undefined) update[field] = leadData[field];
    }
    // 数据范围：目标线索本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    // 该门**先于任何写入**（lead.update / leadItem.deleteMany / leadItem.create）。
    const existing = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, channelId: true, shopId: true },
    });
    if (!existing) {
      fail(res, 404, '线索不存在');
      return;
    }

    // P5-OWN-01（F-NEW-05）：`ownerId` 属 LEAD_WRITABLE_FIELDS，改派归属必须通过目标用户
    // 数据范围校验，且**先于任何写入**（lead.update / leadItem.deleteMany / leadItem.create）。
    // `ownerId = null` 表示释放到公海（DQ-1=A1），允许；`undefined` 表示不修改，不触发校验。
    if (leadData.ownerId !== undefined && leadData.ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: applyScope({ id: leadData.ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true },
      });
      if (!owner) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }

    // BC-8-3（DQ-8-B B1）：`customerId` 引用授权（与 createLead 同口径）；
    // `null` 表示清空引用（透传）；不可见与不存在同结果（400 `客户不存在`）。先于任何写入。
    if (leadData.customerId !== undefined && leadData.customerId !== null) {
      const customer = await prisma.customer.findFirst({
        where: applyScope({ id: leadData.customerId }, includePublicSea(await roleScope(req))),
        select: { id: true },
      });
      if (!customer) {
        fail(res, 400, '客户不存在');
        return;
      }
    }

    // F-8L-A · 来源渠道/来源平台：编辑时同样必须重新校验（先于任何写入）。
    // 仅传其一（另一保持原值）时，用持久值补齐构成有效组合，再校验父子一致性；
    // 不自动替用户改写 shopId（如只改 channelId 导致 shop.parentId !== newChannelId，则拒绝）。
    const effChannelId = leadData.channelId !== undefined ? leadData.channelId : existing.channelId;
    const effShopId = leadData.shopId !== undefined ? leadData.shopId : existing.shopId;
    if (!(await validateChannelShop(res, effChannelId, effShopId))) return;

    // 引用侧（DQ-3=C）：产品可见性校验必须**先于任何写入**（含 lead.update 与明细重建），
    // 否则拒绝发生在写入之后会造成「授权后于变更」。不可见与不存在同结果（400）。
    let resolvedProductName: string | null = null;
    if (productId) {
      const product = await prisma.product.findFirst({
        where: { id: productId, ...productVisibilityWhere(req) },
        select: { name: true },
      });
      if (!product) {
        fail(res, 400, '产品不存在');
        return;
      }
      resolvedProductName = product.name;
    }

    await prisma.lead.update({ where: { id: existing.id }, data: update });

    // V1.0：产品关联整表重建于 LeadItem（owner 为 leadId，不能误用 opportunityId）
    if (productId !== undefined) {
      await prisma.leadItem.deleteMany({ where: { leadId: existing.id } });
      if (productId) {
        await prisma.leadItem.create({
          data: {
            leadId: existing.id,
            productId,
            productName: resolvedProductName ?? productName ?? null,
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
    // P5-SCOPE（F-NEW-13-A）：目标线索必须落在调用方数据范围内（scoped single-record 语义，
    // 与 3C-6-3 的单条读取口径一致）；scope 外与不存在同响应 404。
    const lead = await prisma.lead.findFirst({
      where: await scopedWhere(req, id),
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
    // actor 规则不变（owner OR admin）；非本人统一 404「线索不存在」（可见 ≠ 可操作，
    // DEPT 成员的线索对本用户不可执行）—— 消除 404/403 可区分的存在性/归属 oracle。
    if (lead.ownerId !== userId && roleCode !== 'admin') {
      fail(res, 404, '线索不存在');
      return;
    }
    const updates: any[] = [prisma.lead.update({ where: { id }, data: { ownerId: null } })];

    // BC-8-3B（DQ-8-B B2）：Customer 联动必须**独立于 Lead 访问权**做 Customer 变更授权
    // （仅 Customer owner 或 admin）；授权条件直接表达在查询中（不以裸 findUnique 作为授权判据）。
    // 无权修改时**跳过**联动，Lead 释放主操作照常成功（先例：claimLead「避免抢夺他人客户」保护）。
    const mutableCustomer = lead.customerId
      ? await prisma.customer.findFirst({
          where:
            roleCode === 'admin'
              ? { id: lead.customerId }
              : { id: lead.customerId, ownerId: userId },
          select: { id: true },
        })
      : null;
    if (mutableCustomer && lead.customerId) {
      // 联动释放客户到公海（ownerId 置空）
      updates.push(
        prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: null, isKeyAccount: false } }),
      );
    }

    // BC-8-4（DQ-8-D）：产品联动必须在**mutation 时刻**重新执行当前 Product 可见性授权
    // （attach-time 校验不足以防 TOCTOU）；不再可见的产品从 mutation 集合中排除（跳过，不阻断主操作）。
    const productIds = lead.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
    let releasedProductIds: string[] = [];
    if (productIds.length) {
      const visibleProducts = await prisma.product.findMany({
        where: { id: { in: productIds }, ...productVisibilityWhere(req) },
        select: { id: true },
      });
      releasedProductIds = visibleProducts.map((p) => p.id);
      if (releasedProductIds.length) {
        // 联动产品释放：默认公开（visibility -> PUBLIC），并清空负责人
        updates.push(
          prisma.product.updateMany({
            where: { id: { in: releasedProductIds } },
            data: { visibility: 'PUBLIC', ownerId: null },
          }),
        );
      }
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
      // BC-8-3B B3：日志只描述**实际发生**的联动（跳过时不得虚报）
      summary: `${username} 释放该线索到公海${mutableCustomer ? '，并释放关联客户到公海' : ''}${releasedProductIds.length ? `，关联 ${releasedProductIds.length} 个产品置为公开` : ''}`,
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
        // 引用侧（DQ-3=C / F-NEW-09）：不可见产品不得进入归属改写目标；
        // claim 主体（线索 / 客户归属）不受影响，仍应成功。
        where: { id: { in: productIds }, ...productVisibilityWhere(req) },
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

    // P5-SCOPE（F-NEW-13-B）：目标线索必须落在调用方数据范围内（与 releaseLead / 3C-6-3 一致）；
    // scope 外与不存在同响应 404。
    const lead = await prisma.lead.findFirst({
      where: await scopedWhere(req, id),
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
    // actor 规则不变（owner OR admin）；非本人统一 404「线索不存在」（可见 ≠ 可操作）。
    if (lead.ownerId !== userId && roleCode !== 'admin') {
      fail(res, 404, '线索不存在');
      return;
    }
    // P5-OWN-02（F-NEW-02）：目标 owner 必须同时满足「存在 + 属于调用方数据范围 + ACTIVE」。
    // 「有权转交当前线索」≠「可转交给任意用户」——后者为独立授权边界；且本次转交会联动
    // 改写 customer.ownerId 与 PRIVATE 产品可见人，故必须在**任何写入之前**完成校验。
    // scope 外与不存在使用同一文案，不泄露目标用户是否存在（不引入 403）。
    const newOwner = await prisma.user.findFirst({
      where: applyScope({ id: newOwnerId }, await roleScope(req, { field: 'id' })),
      select: { id: true, status: true, username: true, realName: true },
    });
    if (!newOwner) {
      fail(res, 400, '业务归属人不存在或无权限指派');
      return;
    }
    if (newOwner.status !== 'ACTIVE') {
      fail(res, 400, '目标用户不存在或已停用');
      return;
    }
    const oldOwnerName = lead.owner?.realName || '未分配';

    const updates: any[] = [prisma.lead.update({ where: { id }, data: { ownerId: newOwnerId } })];

    // BC-8-3B（DQ-8-B B2）：同 releaseLead —— Customer 联动必须独立授权（仅 Customer owner 或 admin），
    // 授权条件直接表达在查询中（不以裸 findUnique 作为授权判据）；无权时跳过联动，转交主操作照常成功。
    const mutableCustomer = lead.customerId
      ? await prisma.customer.findFirst({
          where:
            roleCode === 'admin'
              ? { id: lead.customerId }
              : { id: lead.customerId, ownerId: userId },
          select: { id: true },
        })
      : null;
    if (mutableCustomer && lead.customerId) {
      // 转移客户：负责人改为当前(目标)用户
      updates.push(prisma.customer.update({ where: { id: lead.customerId }, data: { ownerId: newOwnerId } }));
    }
    // 转移产品：私密(PRIVATE)则把目标用户加入可见人，公开(PUBLIC)保持
    // visibleUsers 是关联表（ProductVisibleUser）而非字符串数组，需用关系型写入；
    // 联合唯一 (productId, userId) 保证重复转交不会插入重复可见人
    // BC-8-4（DQ-8-D）：在 mutation 时刻按**当前** Product 可见性重新校验（关闭 TOCTOU）；
    // 当前已不可见的产品从 mutation 集合中排除（跳过，不阻断主操作）。
    const privateProductIds = lead.items
      .map((i) => i.product)
      .filter((p) => p && p.visibility === 'PRIVATE')
      .map((p) => p!.id);
    let transferProductIds: string[] = [];
    if (privateProductIds.length) {
      const visibleProducts = await prisma.product.findMany({
        where: { id: { in: privateProductIds }, ...productVisibilityWhere(req) },
        select: { id: true },
      });
      const visibleIdSet = new Set(visibleProducts.map((p) => p.id));
      transferProductIds = privateProductIds.filter((pid) => visibleIdSet.has(pid));
    }
    for (const productId of transferProductIds) {
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
      summary: `${username} 将线索从「${oldOwnerName}」转交给「${newOwner.realName || newOwner.username}」${mutableCustomer ? '，并转移关联客户' : ''}${transferProductIds.length ? `，关联 ${transferProductIds.length} 个私密产品加入可见人` : ''}`,
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
    // V1.0：与 Prisma LeadStatus 严格一致（不含 VALID）
    const { status } = z.object({ status: z.nativeEnum(LeadStatus) }).parse(req.body);
    // 数据范围：目标线索本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    // scope 条件会注入非唯一条件，故 `findUnique` → `findFirst`。
    const existing = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, leadNo: true, status: true, customerId: true },
    });
    if (!existing) {
      fail(res, 404, '线索不存在');
      return;
    }
    await prisma.lead.update({ where: { id: existing.id }, data: { status } });

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
