import { Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { activityLogger } from '../lib/activity-logger';
import { ownerScope, applyScope } from '../utils/scope';
import { paginateList } from '../utils/query';

// ============ 校验 ============

const createPipelineSchema = z.object({
  customerId: z.string().optional().nullable(),
  stage: z.enum(['LEAD', 'OPPORTUNITY', 'SAMPLE', 'ORDER']).default('LEAD'),
  title: z.string().min(1, '标题不能为空'),
  companyName: z.string().min(1, '公司名称不能为空'),
  contactName: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
  productInterest: z.string().optional().nullable(),
  leadNotes: z.string().optional().nullable(),
  estimatedAmount: z.number().optional().nullable(),
  estimatedCloseDate: z.string().optional().nullable(),
  probability: z.string().optional().nullable(),
  opportunityNotes: z.string().optional().nullable(),
  sampleType: z.string().optional().nullable(),
  sampleQuantity: z.number().int().optional().nullable(),
  sampleStatus: z.string().optional().nullable(),
  sampleNotes: z.string().optional().nullable(),
  orderAmount: z.number().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  deliveryDate: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable(),
  orderStatus: z.string().optional().nullable(),
  orderType: z.enum(['SAMPLE', 'FORMAL']).optional().nullable(),
  orderNotes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  // 线索关联产品：[{ productId, quantity }]
  products: z.array(z.object({
    productId: z.string(),
    quantity: z.number().int().positive().optional(),
  })).optional().nullable(),
});

const updatePipelineSchema = createPipelineSchema.partial();

// ============ 列表 ============

export const getPipelines = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page = '1', pageSize = '20', keyword = '', stage = '', assignedTo = '',
      startDate, endDate, source = '',
    } = req.query as Record<string, string>;

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: Record<string, unknown> = {};
    const AND: unknown[] = [];

    if (keyword) {
      AND.push({
        OR: [
          { title: { contains: keyword } },
          { companyName: { contains: keyword } },
          { contactName: { contains: keyword } },
          { email: { contains: keyword } },
        ],
      });
    }
    if (stage) where.stage = stage;
    if (source) where.source = source;
    if (startDate || endDate) {
      const dateFilter: Record<string, string> = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      where.createdAt = dateFilter;
    }

    // 数据范围：管理员可用 assignedTo 自由筛选；普通用户只看「自己负责的 + 未分配（公海）」商机
    if (assignedTo && (req.roleCode === 'admin' || req.roleCode === 'ADMIN')) {
      where.assignedTo = assignedTo;
    } else {
      applyScope(where, ownerScope(req, { field: 'assignedTo', includePublicSea: true }));
    }

    if (AND.length > 0) where.AND = AND;

    const { list, total, page: p, pageSize: ps } = await paginateList(
      prisma.salesPipeline,
      where,
      {
        page: Number(page),
        pageSize: Number(pageSize),
        include: {
          assignee: { select: { id: true, realName: true, username: true } },
          leadProducts: {
            include: { product: { select: { id: true, name: true, sku: true, audienceId: true, categoryId: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { updatedAt: 'desc' },
      },
    );

    success(res, { list, total, page: p, pageSize: ps });
  } catch (e) {
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 看板统计 ============

export const getKanban = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const where: Record<string, unknown> = {};
    if (req.roleCode !== 'admin') {
      where.OR = [{ assignedTo: req.userId }, { assignedTo: null }];
    }

    const pipelines = await prisma.salesPipeline.findMany({
      where,
      include: { assignee: { select: { id: true, realName: true, username: true } } },
      orderBy: { updatedAt: 'desc' },
    });

    // 按阶段分组
    const columns = {
      LEAD: { title: '线索', items: [] as typeof pipelines },
      OPPORTUNITY: { title: '商机', items: [] as typeof pipelines },
      SAMPLE: { title: '样品单', items: [] as typeof pipelines },
      ORDER: { title: '订单', items: [] as typeof pipelines },
    };

    for (const p of pipelines) {
      if (columns[p.stage as keyof typeof columns]) {
        columns[p.stage as keyof typeof columns].items.push(p);
      }
    }

    // 各阶段统计
    const stats = {
      LEAD: columns.LEAD.items.length,
      OPPORTUNITY: columns.OPPORTUNITY.items.length,
      SAMPLE: columns.SAMPLE.items.length,
      ORDER: columns.ORDER.items.length,
      total: pipelines.length,
    };

    success(res, { columns, stats });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============

export const getPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pipeline = await prisma.salesPipeline.findUnique({
      where: { id: req.params.id },
      include: {
        assignee: { select: { id: true, realName: true, username: true } },
        activities: { orderBy: { createdAt: 'desc' }, take: 30 },
        leadProducts: {
          include: { product: { select: { id: true, name: true, sku: true, audienceId: true, categoryId: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!pipeline) { fail(res, 404, '记录不存在'); return; }
    success(res, pipeline);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 按产品查询商机/线索 ============

export const getByProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;

    const where: Record<string, unknown> = {
      leadProducts: { some: { productId } },
    };
    // 非 admin 用户只看自己或未分配
    if (req.roleCode !== 'admin') {
      where.OR = [{ assignedTo: req.userId }, { assignedTo: null }];
    }

    const pipelines = await prisma.salesPipeline.findMany({
      where,
      include: {
        assignee: { select: { id: true, realName: true, username: true } },
        leadProducts: {
          where: { productId },
          select: { quantity: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    // 仅保留该产品自身的关联数量
    const list = pipelines.map((p) => ({
      id: p.id,
      pipelineNumber: p.pipelineNumber,
      title: p.title,
      companyName: p.companyName,
      contactName: p.contactName,
      stage: p.stage,
      status: p.stage,
      estimatedAmount: p.estimatedAmount,
      amountCNY: p.estimatedAmount,
      updateTime: p.updatedAt,
      quantity: p.leadProducts.reduce((s, lp) => s + (lp.quantity || 0), 0),
      assignee: p.assignee,
    }));

    success(res, { list, total: list.length });
  } catch (e) {
    console.error(e);
    fail(res, 500, '服务器错误');
  }
};

// ============ 创建 ============

export const createPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createPipelineSchema.parse(req.body);

    // 生成商机号: BO-YYYYMMDD-序号（查询当天最大序号避免重复）
    const today = new Date();
    const dateStr = today.getFullYear().toString()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');
    const prefix = `BO-${dateStr}-`;
    const existing = await prisma.salesPipeline.findMany({
      where: { pipelineNumber: { startsWith: prefix } },
      select: { pipelineNumber: true },
    });
    let maxSeq = 0;
    for (const item of existing) {
      if (item.pipelineNumber) {
        const seq = Number(item.pipelineNumber.slice(prefix.length));
        if (!Number.isNaN(seq) && seq > maxSeq) maxSeq = seq;
      }
    }
    const pipelineNumber = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;

    // 从 data 中提取 products（非 SalesPipeline 模型字段），剩余字段用于创建
    const { products, ...pipelineData } = data;

    const pipeline = await prisma.salesPipeline.create({
      data: {
        ...pipelineData,
        pipelineNumber,
        leadProducts: products?.length
          ? {
              create: products.map((p) => ({
                productId: p.productId,
                quantity: p.quantity ?? 1,
              })),
            }
          : undefined,
      },
      include: {
        assignee: { select: { id: true, realName: true, username: true } },
        leadProducts: {
          include: { product: { select: { id: true, name: true, sku: true, audienceId: true, categoryId: true } } },
        },
      },
    });

    // 记录销售活动
    await prisma.salesActivity.create({
      data: {
        pipelineId: pipeline.id,
        action: 'CREATED',
        toStage: data.stage,
        createdBy: req.userId!,
      },
    });

    // 如果关联了客户，同步记录到客户活动记录
    if (data.customerId) {
      await activityLogger.log({
        userId: req.userId!,
        username: req.username!,
        action: 'PIPELINE_CREATED',
        module: 'sales',
        targetId: pipeline.id,
        target: data.title,
        detail: `创建了商机「${data.title}」`,
        customerId: data.customerId,
      });
    }

    created(res, pipeline, '创建成功');
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

export const updatePipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = updatePipelineSchema.parse(req.body);

    const existing = await prisma.salesPipeline.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '记录不存在'); return; }

    // 从 data 中提取 products（非 SalesPipeline 模型字段），剩余字段用于更新
    const { products, ...pipelineData } = data;

    // 若传入 products，则重建线索-产品关联
    if (products !== undefined) {
      await prisma.leadProduct.deleteMany({ where: { leadId: req.params.id } });
    }

    const pipeline = await prisma.salesPipeline.update({
      where: { id: req.params.id },
      data: {
        ...pipelineData,
        leadProducts: products?.length
          ? {
              create: products.map((p) => ({
                productId: p.productId,
                quantity: p.quantity ?? 1,
              })),
            }
          : products !== undefined
            ? { deleteMany: {} }
            : undefined,
      },
      include: {
        assignee: { select: { id: true, realName: true, username: true } },
        leadProducts: {
          include: { product: { select: { id: true, name: true, sku: true, audienceId: true, categoryId: true } } },
        },
      },
    });

    // 如果阶段变更，记录活动
    if (data.stage && data.stage !== existing.stage) {
      await prisma.salesActivity.create({
        data: {
          pipelineId: pipeline.id,
          action: 'STAGE_CHANGE',
          fromStage: existing.stage,
          toStage: data.stage,
          createdBy: req.userId!,
        },
      });
    }

    // 如果关联了客户，同步记录到客户活动记录
    if (existing.customerId) {
      const changes: string[] = [];
      if (data.title && data.title !== existing.title) changes.push('标题');
      if (data.companyName && data.companyName !== existing.companyName) changes.push('公司名称');
      if (data.estimatedAmount !== undefined && data.estimatedAmount !== existing.estimatedAmount) changes.push('预计金额');
      if (data.stage && data.stage !== existing.stage) changes.push('阶段');
      await activityLogger.log({
        userId: req.userId!,
        username: req.username!,
        action: 'PIPELINE_UPDATED',
        module: 'sales',
        targetId: pipeline.id,
        target: data.title || existing.title,
        detail: changes.length > 0
          ? `修改了商机「${data.title || existing.title}」的${changes.join('、')}`
          : `修改了商机「${data.title || existing.title}」`,
        customerId: existing.customerId,
      });
    }

    success(res, pipeline, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    console.error(err);
    fail(res, 500, '服务器错误');
  }
};

// ============ 阶段变更 ============

export const changeStage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { stage } = z.object({ stage: z.enum(['LEAD', 'OPPORTUNITY', 'SAMPLE', 'ORDER']) }).parse(req.body);

    const existing = await prisma.salesPipeline.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '记录不存在'); return; }

    const pipeline = await prisma.salesPipeline.update({
      where: { id: req.params.id },
      data: { stage },
      include: { assignee: { select: { id: true, realName: true, username: true } } },
    });

    await prisma.salesActivity.create({
      data: {
        pipelineId: pipeline.id,
        action: 'STAGE_CHANGE',
        fromStage: existing.stage,
        toStage: stage,
        createdBy: req.userId!,
      },
    });

    const STAGE_LABELS: Record<string, string> = {
      LEAD: '线索', OPPORTUNITY: '商机', SAMPLE: '样品', ORDER: '订单',
    };

    // 如果关联了客户，同步记录到客户活动记录
    if (existing.customerId) {
      await activityLogger.log({
        userId: req.userId!,
        username: req.username!,
        action: 'PIPELINE_STAGE_CHANGE',
        module: 'sales',
        targetId: pipeline.id,
        target: existing.title,
        detail: `将商机「${existing.title}」从「${STAGE_LABELS[existing.stage]}」推进到「${STAGE_LABELS[stage]}」`,
        customerId: existing.customerId,
      });
    }

    success(res, pipeline, '阶段变更成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============

export const deletePipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.salesPipeline.findUnique({ where: { id: req.params.id } });
    if (!existing) { fail(res, 404, '记录不存在'); return; }

    await prisma.salesPipeline.delete({ where: { id: req.params.id } });

    // 如果关联了客户，同步记录到客户活动记录
    if (existing.customerId) {
      await activityLogger.log({
        userId: req.userId!,
        username: req.username!,
        action: 'PIPELINE_DELETED',
        module: 'sales',
        targetId: existing.id,
        target: existing.title,
        detail: `删除了商机「${existing.title}」`,
        customerId: existing.customerId,
      });
    }

    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 批量删除 ============

export const batchDelete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    await prisma.salesPipeline.deleteMany({ where: { id: { in: ids } } });
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

// 字段映射（Excel 表头 → 数据库字段）
const FIELD_MAP: Record<string, string> = {
  '标题': 'title',
  '公司名称': 'companyName',
  '联系人': 'contactName',
  '邮箱': 'email',
  '电话': 'phone',
  '国家': 'country',
  '来源': 'source',
  '产品兴趣': 'productInterest',
  '线索备注': 'leadNotes',
  '预估金额': 'estimatedAmount',
  '预计成交日期': 'estimatedCloseDate',
  '采购意向': 'probability',
  '商机备注': 'opportunityNotes',
  '样品类型': 'sampleType',
  '样品数量': 'sampleQuantity',
  '样品状态': 'sampleStatus',
  '样品备注': 'sampleNotes',
  '订单金额': 'orderAmount',
  '订单日期': 'orderDate',
  '交付日期': 'deliveryDate',
  '付款条件': 'paymentTerms',
  '订单状态': 'orderStatus',
  '订单备注': 'orderNotes',
  '阶段': 'stage',
};

const STAGE_MAP: Record<string, string> = {
  '线索': 'LEAD', '商机': 'OPPORTUNITY', '样品单': 'SAMPLE', '订单': 'ORDER',
  'LEAD': 'LEAD', 'OPPORTUNITY': 'OPPORTUNITY', 'SAMPLE': 'SAMPLE', 'ORDER': 'ORDER',
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
        if (['estimatedAmount', 'sampleQuantity', 'orderAmount'].includes(field)) {
          data[field] = value ? Number(value) : undefined;
        } else if (field === 'stage') {
          data[field] = STAGE_MAP[value?.trim()] || 'LEAD';
        } else {
          data[field] = value?.toString().trim() || undefined;
        }
      }

      if (!data.title || !data.companyName) {
        failCount++;
        errors.push(`第 ${i + 2} 行：标题和公司名称为必填`);
        continue;
      }

      try {
        await prisma.salesPipeline.create({
          data: {
            title: data.title as string,
            companyName: data.companyName as string,
            stage: (data.stage as string) || 'LEAD',
            contactName: data.contactName as string | undefined,
            email: data.email as string | undefined,
            phone: data.phone as string | undefined,
            country: data.country as string | undefined,
            source: data.source as string | undefined || 'EXCEL',
            productInterest: data.productInterest as string | undefined,
            leadNotes: data.leadNotes as string | undefined,
            estimatedAmount: data.estimatedAmount as number | undefined,
            estimatedCloseDate: data.estimatedCloseDate as string | undefined,
            probability: data.probability as string | undefined,
            opportunityNotes: data.opportunityNotes as string | undefined,
            sampleType: data.sampleType as string | undefined,
            sampleQuantity: data.sampleQuantity as number | undefined,
            sampleStatus: data.sampleStatus as string | undefined,
            sampleNotes: data.sampleNotes as string | undefined,
            orderAmount: data.orderAmount as number | undefined,
            orderDate: data.orderDate as string | undefined,
            deliveryDate: data.deliveryDate as string | undefined,
            paymentTerms: data.paymentTerms as string | undefined,
            orderStatus: data.orderStatus as string | undefined,
            orderNotes: data.orderNotes as string | undefined,
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
    const pipelines = await prisma.salesPipeline.findMany({
      where: { customerId: req.params.customerId },
      orderBy: { updatedAt: 'desc' },
    });
    success(res, pipelines);
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
