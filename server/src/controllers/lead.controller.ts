import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope, includePublicSea, productVisibilityWhere, projectProductRows } from '../utils/scope';
import { paginateList } from '../utils/query';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { computeDiff, type FieldFormatter } from '../lib/operation-diff';

/** 线索操作日志的字段中文名（diff 展示用） */
const LEAD_DIFF_LABELS: Record<string, string> = {
  leadName: '线索名称',
  customerId: '客户',
  channelId: '来源渠道',
  shopId: '来源平台',
  source: '来源',
  companyName: '公司名称',
  contactName: '联系人',
  contactMethods: '联系方式',
  email: '邮箱',
  phone: '电话',
  country: '国家',
  productInterest: '产品意向',
  quantity: '数量',
  remark: '备注',
  targetMarket: '目标国家/地区',
  currency: '币种',
  unit: '单位',
  targetPrice: '目标价位',
  usdRate: '建档美元汇率',
  expectedDelivery: '期望交期',
  customerType: '客户类型',
  ownerId: '负责人',
};

/** 操作日志字段值格式化：来源渠道/平台按 ID 解析为名称，联系方式解析为「工具：账号」形式 */
const LEAD_DIFF_FORMATTERS: Record<string, FieldFormatter> = {
  channelId: async (v) => {
    if (!v) return '空';
    const ch = await prisma.channel.findUnique({ where: { id: v as string }, select: { name: true } });
    return ch?.name ?? String(v);
  },
  shopId: async (v) => {
    if (!v) return '空';
    const ch = await prisma.channel.findUnique({ where: { id: v as string }, select: { name: true } });
    return ch?.name ?? String(v);
  },
  contactMethods: (v) => {
    if (!Array.isArray(v) || v.length === 0) return '空';
    return (v as { tool?: string; account?: string }[])
      .map((m) => `${m?.tool || '—'}：${m?.account || '—'}`)
      .join('、');
  },
};

/** 线索状态中文名（4 态；状态由单据事件自动推进，无人工改动入口） */
const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: '新线索',
  CONFIRMED: '已确认',
  SAMPLED: '已打样',
  WON: '已成交',
};

const leadSchema = z.object({
  // 名称可选：未传时由系统按「渠道-平台-采购产品-数量」规则自动生成
  leadName: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  // F-8L-A：来源渠道 / 来源平台正式字段（Lead.channelId / Lead.shopId，均 → Channel）
  channelId: z.string().optional().nullable(),
  shopId: z.string().optional().nullable(),
  // 来源渠道/平台组合值（前端下拉项为 JSON 字符串 {channelId, shopId}）；入库前拆为 channelId/shopId。
  // 与显式 channelId/shopId 二选一传入，sourceKey 优先级更高（见 createLead / updateLead 拆分逻辑）。
  sourceKey: z.string().trim().max(500).optional().nullable(),
  sourceChannel: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  quantity: z.number().int().min(0).optional(),
  source: z.enum(['MANUAL', 'EXCEL', 'RPA', 'SYNC']).optional(),
  // 草稿标记（不落库）：暂存场景传 true，放宽「至少一条有效联系方式」等必填约束，允许空必填创建草稿线索
  draft: z.boolean().optional(),
  // 线索状态不接受外部入参：只由单据事件自动推进（转商机 / 建打样单 / 建销售订单），
  // 见 utils/leadStatus.ts。此处不声明 status（即使前端误传也会被 zod 剥离，不落库）。
  companyName: z.string().trim().max(200).nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(),
  // 联系方式：数组 [{tool, account}]，新增时至少一条（见 createLead 校验）
  contactMethods: z
    .array(
      z.object({
        tool: z.string().trim().min(1).max(100),
        account: z.string().trim().min(1).max(300),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
  email: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().max(50).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  productInterest: z.string().trim().max(300).nullable().optional(),
  productName: z.string().trim().max(200).nullable().optional(),
  remark: z.string().trim().max(1000).nullable().optional(),
  targetMarket: z.string().trim().max(200).nullable().optional(),
  currency: z.string().trim().max(10).nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
  productType: z.string().trim().max(200).nullable().optional(),
  productDesc: z.string().trim().max(2000).nullable().optional(),
  // D1：参考图片接受「URL 字符串」或「{url,name}」对象数组；后端转为 Attachment(ownerType=LEAD) 记录
  images: z
    .array(z.object({ url: z.string().trim().min(1).max(500), name: z.string().trim().max(200).optional() }).or(z.string().trim().min(1).max(500)))
    .max(20)
    .nullable()
    .optional(),
  targetPrice: z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v) => (v === null || v === undefined || v === '' ? null : String(v))),
  expectedDelivery: z.string().trim().max(50).nullable().optional(),
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
  // status 不在白名单：状态只由单据事件推进（utils/leadStatus.ts），不随线索编辑被改写
  'companyName',
  'contactName',
  'contactMethods',
  'email',
  'phone',
  'country',
  'customerType',
  'productInterest',
  'quantity',
  'targetPrice',
  'targetMarket',
  'currency',
  'unit',
  'expectedDelivery',
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
 * D1：归一化前端传来的参考图片/附件。接受「URL 字符串」或「{url,name}」对象数组，
 * 从 /api/uploads/{filename} 还原文件名，并按扩展名推导正确的 mimeType 与 category
 * （图片 → IMAGE，其它 → OTHER），避免把非图片文件误标成 image/*。
 * 仅保留 /api/uploads/ 下的文件，避免把任意外链写入 Attachment 表。
 */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
};

function normalizeImages(
  images?: (string | { url: string; name?: string })[] | null,
): { url: string; fileName: string; mimeType: string; category: string; name?: string }[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((i) => (typeof i === 'string' ? { url: i, name: undefined } : { url: i.url, name: i.name }))
    .filter((x) => x.url && x.url.startsWith('/api/uploads/'))
    .map((x) => {
      const m = x.url.match(/\/api\/uploads\/(.+)$/);
      const fileName = m ? m[1] : x.url;
      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
      const mimeType = MIME_BY_EXT[ext] || 'application/octet-stream';
      const category = mimeType.startsWith('image/') ? 'IMAGE' : 'OTHER';
      return { url: x.url, fileName, mimeType, category, name: x.name };
    });
}

/** D1：批量拉取线索参考图片附件（ownerType=LEAD），按 ownerId 分组（避免 N+1） */
async function loadLeadAttachments(leadIds: string[]): Promise<Record<string, any[]>> {
  if (!leadIds.length) return {};
  const rows = await prisma.attachment.findMany({
    where: { ownerType: 'LEAD', ownerId: { in: leadIds } },
    orderBy: { sort: 'asc' },
  });
  const map: Record<string, any[]> = {};
  for (const r of rows) (map[r.ownerId] ||= []).push(r);
  return map;
}

/** D1：附件对外投影，剥离内部字段，仅暴露展示所需 {id,url,name,category,sort} */
function projectAttachments(rows: any[]): { id: string; url: string; name: string | null; category: string; sort: number }[] {
  return rows.map((a) => ({
    id: a.id,
    url: a.filePath,
    name: a.name ?? a.fileName,
    category: a.category,
    sort: a.sort,
  }));
}

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
/**
 * 拆分组合来源值（sourceKey = JSON `{channelId, shopId}`）为渠道/平台 ID。
 * 用于入库前从前端下拉的组合项拆出独立列（F-8L-A）。解析失败返回空对象，交由显式 channelId/shopId 兜底。
 */
function splitSourceKey(raw?: string | null): { channelId?: string | null; shopId?: string | null } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { channelId?: string; shopId?: string };
    if (parsed && typeof parsed === 'object') {
      return { channelId: parsed.channelId ?? null, shopId: parsed.shopId ?? null };
    }
  } catch {
    /* 非 JSON 则忽略，回退到显式 channelId/shopId */
  }
  return {};
}

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
    // 来源渠道 / 来源平台：按 channelId / shopId 精确匹配（前端筛选项已改为传 ID）
    if (channel && platform) {
      where.AND = [{ channelId: channel }, { shopId: platform }];
    } else if (channel) {
      where.channelId = channel;
    } else if (platform) {
      where.shopId = platform;
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

    // 排序（白名单，防止任意字段注入）；未传时 paginateList 默认 createdAt 倒序
    const sort = req.query.sort as string;
    const SORT_WHITELIST: Record<string, Record<string, 'asc' | 'desc'>> = {
      'createdAt:desc': { createdAt: 'desc' },
      'createdAt:asc': { createdAt: 'asc' },
      'updatedAt:desc': { updatedAt: 'desc' },
      'updatedAt:asc': { updatedAt: 'asc' },
    };

    const { list, total, page: p, pageSize: ps } = await paginateList(
      prisma.lead,
      where,
      {
        page,
        pageSize,
        orderBy: SORT_WHITELIST[sort],
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
        const leadIds = (list as { id: string }[]).map((l) => l.id);
        const attMap = await loadLeadAttachments(leadIds);
        const safeList = (list as { id: string; items: Record<string, unknown>[] }[]).map((lead) => ({
          ...lead,
          items: projectProductRows(req, lead.items, LEAD_ITEM_PRODUCT_FIELDS, { nameField: 'productName' }),
          // D1：参考图片（Attachment ownerType=LEAD）
          attachments: projectAttachments(attMap[lead.id] || []),
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
    const attachments = await loadLeadAttachments([item.id]);
    success(res, {
      ...item,
      items: projectProductRows(req, item.items, LEAD_ITEM_PRODUCT_FIELDS, { nameField: 'productName' }),
      // D1：参考图片（Attachment ownerType=LEAD）
      attachments: projectAttachments(attachments[item.id] || []),
    });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

/**
 * GET /api/leads/:id/logs —— 线索操作记录（详情面板「操作记录」Tab 数据源）。
 *
 * 只读 OperationLog 中 `businessType = LEAD` 且 `businessId = 线索 id` 的记录，
 * 按时间倒序返回。数据范围门：线索不可见与不存在**同响应 404**（不泄露存在性）。
 * 与全局日志页（`/api/operations`，需 `system:logs` 权限）解耦：业务用户查看自己可见
 * 线索的操作记录无需审计权限，但仍受数据范围约束。
 */
export const getLeadLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const lead = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    const list = await prisma.operationLog.findMany({
      where: { businessType: BUSINESS_TYPE.LEAD, businessId: lead.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

/**
 * 抓取「建档美元汇率」：当日 DailyExchangeRate 中 USD 的 rateToCny（1 USD = X CNY）。
 * 优先取当日记录；缺当日则取最近历史；都无则回退内置参考值（与 exchange.controller FALLBACK_RATES 一致）。
 * 该值于线索建档时落库一次（Lead.usdRate），与线索自身币种无关。
 */
async function getTodayUsdRate(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const toDbDate = (d: string) => new Date(`${d}T00:00:00.000Z`);
  let row = await prisma.dailyExchangeRate.findFirst({
    where: { date: toDbDate(today), currencyCode: 'USD' },
    select: { rateToCny: true },
  });
  if (!row) {
    row = await prisma.dailyExchangeRate.findFirst({
      where: { currencyCode: 'USD' },
      orderBy: { date: 'desc' },
      select: { rateToCny: true },
    });
  }
  if (row) return Number(row.rateToCny);
  return 7.14285714; // 内置参考：1 USD ≈ 7.14285714 CNY
}

export const createLead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = leadSchema.parse(req.body);
    // 来源拆分：优先用组合 sourceKey（{channelId, shopId}）拆出渠道/平台，回退显式 channelId/shopId（F-8L-A）
    const fromSourceKey = splitSourceKey(data.sourceKey);
    const channelId = fromSourceKey.channelId !== undefined ? fromSourceKey.channelId : (data.channelId ?? null);
    const shopId = fromSourceKey.shopId !== undefined ? fromSourceKey.shopId : (data.shopId ?? null);
    // 联系方式：新增线索必须至少一条有效记录（{tool, account} 均非空）；草稿（draft）模式允许为空
    if (!data.draft) {
      if (!data.contactMethods || data.contactMethods.length === 0) {
        fail(res, 400, '请至少填写一条联系方式');
        return;
      }
    }
    // 名称可选：未传时按「目标国家-产品名称」规则自动生成（修复 leadName 未定义导致创建必 500 的问题）
    const leadName = data.leadName ?? ([data.targetMarket, data.productName].filter(Boolean).join('-') || '未命名线索');

    // V1.0：Lead 的产品关联落在 LeadItem 上（Lead 1:N LeadItem），写入时带产品名快照。
    // 只要有产品关联信息（引用 productId，或自由输入的 productName/productDesc）就持久化，
    // 避免「手动输入产品名/描述」被静默丢弃导致无法回填（见 getLead 的 items 回填链路）。
    let leadItems: { productId: string | null; productName: string | null; quantity: number; productDesc: string | null }[] | undefined;
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
        // D2：产品描述落在 LeadItem 明细行
        productDesc: data.productDesc ?? null,
      }];
    } else if (data.productName || data.productDesc) {
      // 自由输入（未在下拉匹配到产品，productId 为空）：保留手输产品名/描述以便回填
      leadItems = [{
        productId: null,
        productName: data.productName ?? null,
        quantity: data.quantity || 1,
        productDesc: data.productDesc ?? null,
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
    if (!(await validateChannelShop(res, channelId, shopId))) return;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const leadNo = await getNextNumber(tx, 'LEAD');

      const lead = await tx.lead.create({
        data: {
          leadName,
          customerId: data.customerId ?? null,
          channelId: channelId ?? null,
          shopId: shopId ?? null,
          quantity: data.quantity ?? 0,
          source: data.source ?? 'MANUAL',
          // 新建线索恒为「新线索」：状态推进只发生在绑定商机 / 生成打样单 / 生成订单时
          status: 'NEW',
          companyName: data.companyName ?? null,
          contactName: data.contactName ?? null,
          contactMethods: data.contactMethods ?? undefined,
          email: data.email ?? null,
          phone: data.phone ?? null,
          country: data.country ?? null,
          productInterest: data.productInterest ?? null,
          remark: data.remark ?? null,
          targetMarket: data.targetMarket ?? null,
          currency: data.currency ?? null,
          unit: data.unit ?? null,
          targetPrice: data.targetPrice ?? null,
          // 建档美元汇率：抓取建档当日 1 USD = X CNY 快照（与线索币种无关，建档后不随编辑变更）
          usdRate: await getTodayUsdRate(),
          expectedDelivery: data.expectedDelivery ?? null,
          customerType: data.customerType ?? null,
          ownerId: data.ownerId ?? null,
          createdBy: req.userId ?? null,
          leadNo,
          ...(leadItems ? { items: { create: leadItems } } : {}),
        },
      });

      // D1：参考图片 → Attachment(ownerType=LEAD) 记录（全仓 Attachment 范式；Lead 为首个落地资源）
      const atts = normalizeImages(data.images);
      if (atts.length) {
        await tx.attachment.createMany({
          data: atts.map((a) => ({
            ownerType: 'LEAD',
            ownerId: lead.id,
            category: a.category,
            fileName: a.fileName,
            name: a.name ?? a.fileName,
            filePath: a.url,
            mimeType: a.mimeType,
            fileSize: null,
            uploadedBy: req.userId ?? null,
          })),
        });
      }

      return lead;
    });

    // 线索操作记录（详情面板「操作记录」Tab 的数据源）
    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: item.id,
      businessNo: item.leadNo,
      summary: `创建了线索「${item.leadName || item.leadNo}」`,
      ip: req.ip,
      customerId: item.customerId || undefined,
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
    // V1.0：productId / productName 不再属于 Lead 标量，改由 LeadItem 承载；productDesc 落在 LeadItem
    const { productId, productName, productDesc, ...leadData } = data;
    // V1.0：只写入与 Prisma Lead 标量一致的字段（legacy sourceChannel / productType /
    // productDesc / images 被接受但不落库，见 LEAD_WRITABLE_FIELDS；null 亦会透传以支持清空）
    const update: Record<string, unknown> = {};
    for (const field of LEAD_WRITABLE_FIELDS) {
      if (leadData[field] !== undefined) update[field] = leadData[field];
    }
    // 数据范围：目标线索本身必须落在当前用户 ownerId 范围内（scope 外与不存在同响应 404）
    // 该门**先于任何写入**（lead.update / leadItem.deleteMany / leadItem.create）。
    // 取整行作为 diff 的 before 基准（变更字段对比需要旧值）
    const existing = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
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
    // 若传入组合 sourceKey，优先拆出 channelId/shopId 覆盖显式值；仅传其一（另一保持原值）时，
    // 用持久值补齐构成有效组合，再校验父子一致性；不自动替用户改写 shopId。
    const fromSourceKey = splitSourceKey(leadData.sourceKey);
    if (fromSourceKey.channelId !== undefined) leadData.channelId = fromSourceKey.channelId;
    if (fromSourceKey.shopId !== undefined) leadData.shopId = fromSourceKey.shopId;
    const effChannelId = leadData.channelId !== undefined ? leadData.channelId : existing.channelId;
    const effShopId = leadData.shopId !== undefined ? leadData.shopId : existing.shopId;
    if (!(await validateChannelShop(res, effChannelId, effShopId))) return;

    // 将拆分后的来源渠道/平台写回更新对象（LEAD_WRITABLE_FIELDS 循环在拆分之前执行，
    // 仅读取了显式 channelId/shopId；此处用有效组合值覆盖，确保编辑时来源选择正确落库）。
    update.channelId = effChannelId ?? null;
    update.shopId = effShopId ?? null;

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

    // D1：参考图片 → Attachment(ownerType=LEAD)；以「整组替换」语义维护（传入则删除旧记录后重建）
    if (data.images !== undefined) {
      await prisma.attachment.deleteMany({ where: { ownerType: 'LEAD', ownerId: existing.id } });
      const atts = normalizeImages(data.images);
      if (atts.length) {
        await prisma.attachment.createMany({
          data: atts.map((a) => ({
            ownerType: 'LEAD',
            ownerId: existing.id,
            category: a.category,
            fileName: a.fileName,
            name: a.name ?? a.fileName,
            filePath: a.url,
            mimeType: a.mimeType,
            fileSize: null,
            uploadedBy: req.userId ?? null,
          })),
        });
      }
    }

    // V1.0：产品关联维护于 LeadItem（owner 为 leadId，不能误用 opportunityId）。
    // 规则：
    //  - 显式传 productId（含 null=清空）：整组替换旧明细（productId 置空但保留手输名/描述则补建无关联行）；
    //  - 仅传自由输入的产品名/描述（productId 未传）：在已有明细行增量更新，无行则补建。
    // 目标：手动输入的产品名/描述也能持久化，避免重开线索时无法回填。
    if (productId !== undefined) {
      await prisma.leadItem.deleteMany({ where: { leadId: existing.id } });
      if (productId) {
        await prisma.leadItem.create({
          data: {
            leadId: existing.id,
            productId,
            productName: resolvedProductName ?? productName ?? null,
            // D2：产品描述落在 LeadItem 明细行
            productDesc: productDesc ?? null,
            quantity: data.quantity || 1,
          },
        });
      } else if (data.productName || data.productDesc) {
        // productId 显式置空但保留了手输产品名/描述 → 落为无关联产品的明细行
        await prisma.leadItem.create({
          data: {
            leadId: existing.id,
            productId: null,
            productName: data.productName ?? null,
            productDesc: data.productDesc ?? null,
            quantity: data.quantity || 1,
          },
        });
      }
    } else {
      // 未传 productId：增量更新已有明细行的手输产品名/描述（productId 引用不动）
      const patch: Record<string, unknown> = {};
      if (productName !== undefined) patch.productName = productName ?? null;
      if (productDesc !== undefined) patch.productDesc = productDesc ?? null;
      if (Object.keys(patch).length) {
        const existingItem = await prisma.leadItem.findFirst({ where: { leadId: existing.id }, select: { id: true } });
        if (existingItem) {
          await prisma.leadItem.update({ where: { id: existingItem.id }, data: patch });
        } else {
          await prisma.leadItem.create({
            data: { leadId: existing.id, productId: null, productName: data.productName ?? null, productDesc: data.productDesc ?? null, quantity: data.quantity || 1 },
          });
        }
      }
    }

    // 线索操作记录（详情面板「操作记录」Tab 的数据源）：记录字段级变更明细
    const diff = await computeDiff(
      existing as unknown as Record<string, any>,
      { ...(existing as unknown as Record<string, any>), ...update } as Record<string, any>,
      { labels: LEAD_DIFF_LABELS, formatters: LEAD_DIFF_FORMATTERS, fields: Object.keys(update) },
    );
    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.LEAD,
      businessId: existing.id,
      businessNo: existing.leadNo,
      summary: `更新了线索「${existing.leadName || existing.leadNo}」${diff.length ? `（${diff.length} 处变更）` : ''}`,
      diff,
      ip: req.ip,
      customerId: typeof update.customerId === 'string' ? update.customerId : undefined,
    });

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
    // 仅取日志所需字段，不改变既有删除行为（日志须在对象删除后仍存活，故删除前取值）
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      select: { id: true, leadNo: true, leadName: true, customerId: true },
    });
    await prisma.lead.delete({ where: { id: req.params.id } });

    if (lead) {
      void activityLogger.log({
        userId: req.userId ?? '',
        username: req.username ?? '',
        realName: req.realName,
        action: 'DELETE',
        module: 'sales',
        businessType: BUSINESS_TYPE.LEAD,
        businessId: lead.id,
        businessNo: lead.leadNo,
        summary: `删除了线索「${lead.leadName || lead.leadNo}」`,
        ip: req.ip,
        customerId: lead.customerId || undefined,
      });
    }
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ========== 删除线索参考图片附件（D1：Attachment ownerType=LEAD） ==========
export const deleteLeadAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 数据范围：目标线索须落在当前用户范围内（scope 外与不存在同响应 404）
    const lead = await prisma.lead.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true },
    });
    if (!lead) {
      fail(res, 404, '线索不存在');
      return;
    }
    // 附件须归属该线索且为 LEAD 宿主，杜绝越权删除他人附件
    const att = await prisma.attachment.findFirst({
      where: { id: req.params.attachmentId, ownerType: 'LEAD', ownerId: lead.id },
    });
    if (!att) {
      fail(res, 404, '附件不存在');
      return;
    }
    await prisma.attachment.delete({ where: { id: att.id } });
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

// 人工改状态入口已下线：线索状态只由单据事件自动推进（绑定商机 → 已确认 / 建打样单 → 已打样 / 建订单 → 已成交），
// 见 utils/leadStatus.ts。原 `PATCH /leads/:id/status`（changeLeadStatus）已从路由移除，
// 且 `status` 不在 PUT 白名单内，避免状态与实际单据不一致的脏值。
