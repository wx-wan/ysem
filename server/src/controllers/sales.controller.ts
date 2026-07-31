import { Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

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
  orderNotes: z.string().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
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
    if (assignedTo) where.assignedTo = assignedTo;
    if (source) where.source = source;
    if (startDate || endDate) {
      const dateFilter: Record<string, string> = {};
      if (startDate) dateFilter.gte = startDate;
      if (endDate) dateFilter.lte = endDate;
      where.createdAt = dateFilter;
    }

    // 非 admin 用户只看自己或未分配
    if (req.roleCode !== 'admin') {
      AND.push({
        OR: [{ assignedTo: req.userId }, { assignedTo: null }],
      });
    }

    if (AND.length > 0) where.AND = AND;

    const [list, total] = await Promise.all([
      prisma.salesPipeline.findMany({
        where,
        skip,
        take,
        include: { assignee: { select: { id: true, realName: true, username: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.salesPipeline.count({ where }),
    ]);

    success(res, { list, total, page: Number(page), pageSize: Number(pageSize) });
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
      },
    });
    if (!pipeline) { fail(res, 404, '记录不存在'); return; }
    success(res, pipeline);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 创建 ============

export const createPipeline = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = createPipelineSchema.parse(req.body);

    // 生成商机号: BO-YYYYMMDD-序号
    const today = new Date();
    const dateStr = today.getFullYear().toString()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const todayCount = await prisma.salesPipeline.count({
      where: { createdAt: { gte: todayStart } },
    });
    const pipelineNumber = `BO-${dateStr}-${String(todayCount + 1).padStart(3, '0')}`;

    const pipeline = await prisma.salesPipeline.create({
      data: { ...data, pipelineNumber },
      include: { assignee: { select: { id: true, realName: true, username: true } } },
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
      await prisma.customerActivity.create({
        data: {
          customerId: data.customerId,
          action: 'PIPELINE_CREATED',
          detail: `创建了商机「${data.title}」`,
          createdBy: req.username!,
        },
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

    const pipeline = await prisma.salesPipeline.update({
      where: { id: req.params.id },
      data,
      include: { assignee: { select: { id: true, realName: true, username: true } } },
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
    await prisma.salesPipeline.delete({ where: { id: req.params.id } });
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
