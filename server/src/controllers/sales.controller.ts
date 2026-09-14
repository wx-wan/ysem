import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { applyScope, roleScope } from '../utils/scope';
import { BUSINESS_TYPE } from '../lib/business-type';
import { paginateList } from '../utils/query';
import { deriveStages, PIPELINE_STAGES, type PipelineStage } from '../utils/pipelineStage';

// ============ 校验 ============

/**
 * 旧版 probability 存的是中文意向文案，V1.0 对应 Opportunity.intentLevel（IntentLevel 枚举），
 * V1.0 的 Opportunity.probability 为 0~100 的百分数（新增字段）。
 */
const INTENT_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'READY'] as const;

const LEGACY_PROBABILITY_TO_INTENT: Record<string, (typeof INTENT_LEVELS)[number]> = {
  '低意向': 'LOW',
  '中意向': 'MEDIUM',
  '高意向': 'HIGH',
  '准成交': 'READY',
};

const createOpportunitySchema = z.object({
  // V1.0：Opportunity.customerId 必填（Restrict），商机必须挂在既有客户下
  customerId: z.string().min(1, '客户不能为空'),
  // 阶段不再由前端传入，统一由关联单据推导（见 utils/pipelineStage.ts）
  title: z.string().min(1, '标题不能为空'),
  estimatedAmount: z.number().optional().nullable(),
  estimatedCloseDate: z.string().optional().nullable(),
  /** 兼容旧字段：既可能是中文意向文案（→ intentLevel），也可能是数字概率字符串（→ probability） */
  probability: z.string().optional().nullable(),
  intentLevel: z.enum(INTENT_LEVELS).optional().nullable(),
  notes: z.string().optional().nullable(),
  ownerId: z.string().optional().nullable(),
  // 来源线索 ID（线索确认转商机时绑定，便于溯源）
  leadId: z.string().optional().nullable(),
  // 商机关联产品：[{ productId, quantity }]
  products: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive().optional(),
  })).optional().nullable(),
});

const updateOpportunitySchema = createOpportunitySchema.partial();

/** 商机详情统一 include（V1.0 关系：owner / customer / lead / items / activities） */
const OPPORTUNITY_INCLUDE = {
  owner: { select: { id: true, realName: true, username: true } },
  customer: { select: { id: true, companyName: true, contactName: true } },
  lead: { select: { id: true, leadNo: true, leadName: true } },
  items: {
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { sort: 'asc' },
  },
} as const;

/** 将旧版 probability 文案/数字拆分为 V1.0 的 intentLevel 与 probability */
function splitProbability(raw?: string | null): { intentLevel?: (typeof INTENT_LEVELS)[number]; probability?: number } {
  if (raw === undefined || raw === null || raw === '') return {};
  const mapped = LEGACY_PROBABILITY_TO_INTENT[raw];
  if (mapped) return { intentLevel: mapped };
  const n = Number(raw);
  return Number.isNaN(n) ? {} : { probability: n };
}

/** 构建 OpportunityItem 创建数据（V1.0 要求 productName 快照） */
async function buildItems(
  products: { productId: string; quantity?: number }[] | null | undefined,
): Promise<{ productId: string; productName: string; quantity: number }[]> {
  if (!products || products.length === 0) return [];
  const found = await prisma.product.findMany({
    where: { id: { in: products.map((p) => p.productId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(found.map((p) => [p.id, p.name]));
  return products
    .filter((p) => nameById.has(p.productId))
    .map((p) => ({
      productId: p.productId,
      productName: nameById.get(p.productId)!,
      quantity: p.quantity ?? 1,
    }));
}

/** 生成商机号: BO-YYYYMMDD-序号（与 V1.0 opportunityNo 对齐；NumberSequence 运行时接入不在本轮） */
async function nextOpportunityNo(): Promise<string> {
  const today = new Date();
  const dateStr = today.getFullYear().toString()
    + String(today.getMonth() + 1).padStart(2, '0')
    + String(today.getDate()).padStart(2, '0');
  const prefix = `BO-${dateStr}-`;
  const existing = await prisma.opportunity.findMany({
    where: { opportunityNo: { startsWith: prefix } },
    select: { opportunityNo: true },
  });
  let maxSeq = 0;
  for (const item of existing) {
    const seq = Number(item.opportunityNo.slice(prefix.length));
    if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

// ============ 列表 ============

export const getOpportunities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = '1', pageSize = '20', keyword = '', stage = '', ownerId = '',
      startDate, endDate,
    } = req.query as Record<string, string>;

    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize);
    const wantStage = (stage || '').trim() as PipelineStage | '';

    let where: Record<string, unknown> = {};
    const AND: unknown[] = [];

    if (keyword) {
      AND.push({
        OR: [
          { title: { contains: keyword } },
          { customer: { companyName: { contains: keyword } } },
        ],
      });
    }
    // 阶段为派生值，无法通过 SQL 直接过滤：先按派生结果筛选，再分页（见下方 stage 后过滤）
    if (startDate || endDate) {
      const dateFilter: Record<string, string> = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      where.createdAt = dateFilter;
    }

    // 数据范围：管理员可用 ownerId 自由筛选；其余用户按角色 dataScope 过滤（含公海）
    if (ownerId && (req.roleCode === 'admin' || req.roleCode === 'ADMIN')) {
      where.ownerId = ownerId;
    } else {
      where = applyScope(where, await roleScope(req, { field: 'ownerId' }));
    }

    if (AND.length > 0) {
      where.AND = [...((where.AND ?? []) as unknown[]), ...AND];
    }

    // 阶段为派生值：需先取全量（或按阶段过滤后）再分页
    if (wantStage) {
      const all = await prisma.opportunity.findMany({
        where,
        include: OPPORTUNITY_INCLUDE,
        orderBy: { updatedAt: 'desc' },
      });
      const stageMap = await deriveStages(all);
      const filtered = all.filter((o) => stageMap.get(o.id) === wantStage);
      const total = filtered.length;
      const slice = filtered.slice((pageNum - 1) * pageSizeNum, pageNum * pageSizeNum);
      success(res, {
        list: slice.map((o) => ({ ...o, stage: stageMap.get(o.id) })),
        total,
        page: pageNum,
        pageSize: pageSizeNum,
      });
      return;
    }

    const { list, total, page: p, pageSize: ps } = await paginateList(
      prisma.opportunity,
      where,
      {
        page: pageNum,
        pageSize: pageSizeNum,
        include: OPPORTUNITY_INCLUDE,
        orderBy: { updatedAt: 'desc' },
      },
    );

    // 附加派生阶段
    const rows = list as { id: string; leadId?: string | null }[];
    const stageMap = await deriveStages(rows);
    success(res, {
      list: rows.map((o) => ({ ...o, stage: stageMap.get(o.id) })),
      total,
      page: p,
      pageSize: ps,
    });
  } catch (e) {
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 看板统计 ============

export const getKanban = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    // 数据范围：按角色 dataScope 过滤（含公海）
    Object.assign(where, await roleScope(req, { field: 'ownerId' }));

    const opportunities = await prisma.opportunity.findMany({
      where,
      include: { owner: { select: { id: true, realName: true, username: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    // 阶段由关联单据推导，不落库
    const stageMap = await deriveStages(opportunities);
    const withStages = opportunities.map((o) => ({ ...o, stage: stageMap.get(o.id) }));

    // 按派生阶段分组
    const columns = {
      OPPORTUNITY: { title: '商机', items: [] as typeof withStages },
      QUOTED: { title: '已报价', items: [] as typeof withStages },
      SAMPLE: { title: '打样', items: [] as typeof withStages },
      PRODUCTION: { title: '生产', items: [] as typeof withStages },
      SHIPPED: { title: '出运', items: [] as typeof withStages },
      ORDER: { title: '订单', items: [] as typeof withStages },
    };

    for (const o of withStages) {
      const col = columns[o.stage as keyof typeof columns];
      if (col) col.items.push(o);
    }

    // 各阶段统计
    const stats: Record<string, number> = { total: withStages.length };
    for (const s of PIPELINE_STAGES) {
      stats[s] = columns[s as keyof typeof columns]?.items.length ?? 0;
    }

    success(res, { columns, stats });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============

export const getOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: req.params.id },
      include: {
        ...OPPORTUNITY_INCLUDE,
        activities: { orderBy: { createdAt: 'desc' }, take: 30 },
      },
    });
    if (!opportunity) { fail(res, 404, '记录不存在'); return; }

    // 阶段为派生值，附加到详情返回
    const stageMap = await deriveStages([opportunity]);
    success(res, { ...opportunity, stage: stageMap.get(opportunity.id) });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 按产品查询商机 ============

export const getByProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;

    const where: Record<string, unknown> = {
      items: { some: { productId } },
    };
    // 数据范围：按角色 dataScope 过滤（含公海）
    Object.assign(where, await roleScope(req, { field: 'ownerId' }));

    const opportunities = await prisma.opportunity.findMany({
      where,
      include: {
        owner: { select: { id: true, realName: true, username: true } },
        customer: { select: { id: true, companyName: true, contactName: true } },
        items: {
          where: { productId },
          select: { quantity: true },
          orderBy: { sort: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // 阶段为派生值
    const stageMap = await deriveStages(opportunities);

    // 仅保留该产品自身的关联数量
    const list = opportunities.map((o) => ({
      id: o.id,
      opportunityNo: o.opportunityNo,
      title: o.title,
      companyName: o.customer?.companyName ?? null,
      contactName: o.customer?.contactName ?? null,
      stage: stageMap.get(o.id),
      status: stageMap.get(o.id),
      estimatedAmount: o.estimatedAmount,
      amountCNY: o.estimatedAmount,
      updateTime: o.updatedAt,
      quantity: o.items.reduce((s, it) => s + (it.quantity || 0), 0),
      assignee: o.owner,
    }));

    success(res, { list, total: list.length });
  } catch (e) {
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 创建 ============

export const createOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createOpportunitySchema.parse(req.body);

    // V1.0：Opportunity.customerId 必填且 Restrict，先校验客户存在
    const customer = await prisma.customer.findUnique({
      where: { id: data.customerId },
      select: { id: true },
    });
    if (!customer) { fail(res, 400, '客户不存在'); return; }

    const opportunityNo = await nextOpportunityNo();
    const { intentLevel, probability } = splitProbability(data.probability);
    const items = await buildItems(data.products);

    const opportunity = await prisma.opportunity.create({
      data: {
        opportunityNo,
        title: data.title,
        customerId: data.customerId,
        leadId: data.leadId ?? null,
        ownerId: data.ownerId ?? null,
        estimatedAmount: data.estimatedAmount ?? undefined,
        estimatedCloseDate: data.estimatedCloseDate ? new Date(data.estimatedCloseDate) : null,
        intentLevel: data.intentLevel ?? intentLevel ?? undefined,
        probability,
        notes: data.notes ?? undefined,
        items: items.length > 0 ? { create: items } : undefined,
      },
      include: OPPORTUNITY_INCLUDE,
    });

    // 记录商机活动（阶段为派生值，不再记录初始阶段）
    await prisma.opportunityActivity.create({
      data: {
        opportunityId: opportunity.id,
        action: 'CREATED',
        createdBy: req.userId!,
      },
    });

    // 同步记录到客户活动记录（V1.0 customerId 必填，故必定记录）
    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: 'OPPORTUNITY_CREATED',
      module: 'sales',
      businessType: BUSINESS_TYPE.OPPORTUNITY,
      businessId: opportunity.id,
      businessNo: opportunity.opportunityNo,
      summary: `创建了商机「${data.title}」`,
      customerId: data.customerId,
    });

    created(res, opportunity, '创建成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新 ============

export const updateOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updateOpportunitySchema.parse(req.body);

    const existing = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '记录不存在'); return; }

    // 从 data 中提取 products（非 Opportunity 模型字段），剩余字段用于更新
    const { products, probability, ...opportunityData } = data;

    // 若传入 products，则重建商机-产品关联
    if (products !== undefined) {
      await prisma.opportunityItem.deleteMany({ where: { opportunityId: req.params.id } });
    }
    const items = products !== undefined ? await buildItems(products) : [];

    const { intentLevel, probability: numericProbability } = splitProbability(probability);

    const updateData: Prisma.OpportunityUncheckedUpdateInput = {
      ...opportunityData,
      estimatedCloseDate: data.estimatedCloseDate === undefined
        ? undefined
        : data.estimatedCloseDate
          ? new Date(data.estimatedCloseDate)
          : null,
      intentLevel: data.intentLevel ?? intentLevel,
      probability: numericProbability,
      items: products !== undefined && items.length > 0 ? { create: items } : undefined,
    };
    // 未显式传入时不覆盖（Prisma 不接受 undefined 之外还需剔除未变更字段）
    if (data.intentLevel === undefined && intentLevel === undefined) delete updateData.intentLevel;
    if (numericProbability === undefined) delete updateData.probability;

    const opportunity = await prisma.opportunity.update({
      where: { id: req.params.id },
      data: updateData,
      include: OPPORTUNITY_INCLUDE,
    });

    // 阶段为派生值，不支持手动变更，故不再记录阶段变更活动

    // 同步记录到客户活动记录
    const changes: string[] = [];
    if (data.title && data.title !== existing.title) changes.push('标题');
    if (data.estimatedAmount !== undefined && data.estimatedAmount !== existing.estimatedAmount) changes.push('预计金额');
    if (data.notes !== undefined && data.notes !== existing.notes) changes.push('备注');
    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: 'OPPORTUNITY_UPDATED',
      module: 'sales',
      businessType: BUSINESS_TYPE.OPPORTUNITY,
      businessId: opportunity.id,
      businessNo: opportunity.opportunityNo,
      summary: changes.length > 0
        ? `修改了商机「${data.title || existing.title}」的${changes.join('、')}`
        : `修改了商机「${data.title || existing.title}」`,
      customerId: existing.customerId,
    });

    success(res, opportunity, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============

export const deleteOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.opportunity.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '记录不存在'); return; }

    await prisma.opportunity.delete({ where: { id: req.params.id } });

    await activityLogger.log({
      userId: req.userId!,
      username: req.username!,
      action: 'OPPORTUNITY_DELETED',
      module: 'sales',
      businessType: BUSINESS_TYPE.OPPORTUNITY,
      businessId: existing.id,
      businessNo: existing.opportunityNo,
      summary: `删除了商机「${existing.title}」`,
      customerId: existing.customerId,
    });

    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 批量删除 ============

export const batchDelete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    await prisma.opportunity.deleteMany({ where: { id: { in: ids } } });
    success(res, null, `已删除 ${ids.length} 条记录`);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ Excel 导入 ============

// 字段映射（Excel 表头 → V1.0 Opportunity 字段）
// 旧版「公司名称/联系人/邮箱/电话/国家/来源/产品兴趣/线索备注」属于 Lead 域、
// 「样品*」属于 SampleOrder 域、「订单*」属于 SalesOrder 域，V1.0 Opportunity 无对应字段，故不再导入。
const FIELD_MAP: Record<string, string> = {
  '标题': 'title',
  '客户ID': 'customerId',
  '预估金额': 'estimatedAmount',
  '预计成交日期': 'estimatedCloseDate',
  '采购意向': 'probability',
  '商机备注': 'notes',
};

export const importExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { fail(res, 400, '请上传文件'); return; }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

    if (rows.length === 0) { fail(res, 400, '文件无数据'); return; }

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const data: Record<string, unknown> = {};

      for (const [header, value] of Object.entries(row)) {
        const field = FIELD_MAP[header] || header;
        // 数字字段转换
        if (field === 'estimatedAmount') {
          data[field] = value ? Number(value) : undefined;
        } else {
          data[field] = value?.toString().trim() || undefined;
        }
      }

      if (!data.title || !data.customerId) {
        failCount++;
        errors.push(`第 ${i + 2} 行：标题和客户ID为必填`);
        continue;
      }

      // V1.0：customerId 必填且 Restrict，校验客户存在
      const customer = await prisma.customer.findUnique({
        where: { id: data.customerId as string },
        select: { id: true },
      });
      if (!customer) {
        failCount++;
        errors.push(`第 ${i + 2} 行：客户不存在（客户ID：${data.customerId}）`);
        continue;
      }

      try {
        const { intentLevel, probability } = splitProbability(data.probability as string | undefined);
        await prisma.opportunity.create({
          data: {
            opportunityNo: await nextOpportunityNo(),
            title: data.title as string,
            customerId: data.customerId as string,
            estimatedAmount: data.estimatedAmount as number | undefined,
            estimatedCloseDate: data.estimatedCloseDate
              ? new Date(data.estimatedCloseDate as string)
              : null,
            intentLevel,
            probability,
            notes: data.notes as string | undefined,
          },
        });
        successCount++;
      } catch {
        failCount++;
        errors.push(`第 ${i + 2} 行：入库失败`);
      }
    }

    success(res, { successCount, failCount, total: rows.length, errors });
  } catch {
    fail(res, 500, '文件解析失败');
  }
};

// ============ 按客户查询商机记录 ============

export const getByCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = { customerId: req.params.customerId };
    // 数据范围：按角色 dataScope 过滤（修复越权）
    Object.assign(where, await roleScope(req, { field: 'ownerId' }));
    const opportunities = await prisma.opportunity.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });
    success(res, opportunities);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 获取用户列表（用于分配） ============

export const getAssignUsers = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, realName: true, username: true },
    });
    success(res, users);
  } catch {
    fail(res, 500, '服务器错误');
  }
};
