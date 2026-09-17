import { Response } from 'express';
import { z } from 'zod';
import { Currency, Prisma, SampleRoundResult, SampleStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { getNextNumber } from '../lib/numberSequence';
import { DECIMAL_PRECISION, round } from '../utils/currency';

// ============================================================
// 打样领域（V1.0）
//
// 履约链：Opportunity → SampleOrder → SampleRound[] → SalesOrder
//  - SampleOrder 是唯一的正式打样单实体，**不得**回退到 Order(type=SAMPLE)；
//  - SampleRound 是 SampleOrder 的 1:N 历史轮次，**不得**压平成单值字段；
//  - 打样单承载**单产品快照**（schema 无 SampleOrderItem），不得使用 JSON items / OrderItem；
//  - 产品来源恒为 V1.0 Product，**不得**使用 SingleProduct / LeadProduct。
//
// 已 Deferred（不在本轮）：
//  - sampleNo 走 NumberSequence runtime（当前沿用 Round 3B-2-2 已接受的「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - customerSnapshot（ADR-04）形状未定，无消费方，暂不写入
//  - feeAmount 的 CNY 折算（schema 无 exchangeRate / amountCny 列，不得伪造）
// ============================================================

/** 列表统一 include：客户、商机、产品、轮次（roundNo 升序） */
const SAMPLE_ORDER_INCLUDE: Prisma.SampleOrderInclude = {
  customer: { select: { id: true, customerNo: true, companyName: true } },
  opportunity: { select: { id: true, opportunityNo: true, title: true } },
  product: { select: { id: true, name: true, sku: true } },
  rounds: { orderBy: { roundNo: 'asc' } },
};

/** 详情额外 include：来源打样产生的下游销售订单（真实外键在 SalesOrder 一侧） */
const SAMPLE_ORDER_DETAIL_INCLUDE: Prisma.SampleOrderInclude = {
  ...SAMPLE_ORDER_INCLUDE,
  salesOrders: { select: { id: true, orderNo: true, status: true } },
};

/** 金额入参：JSON number 或 string，一律经 Decimal 归一，禁止 JS number 参与运算 */
const amountSchema = z.union([z.number(), z.string()]);

const roundSchema = z.object({
  designAt: z.string().optional().nullable(),
  moldAt: z.string().optional().nullable(),
  sentAt: z.string().optional().nullable(),
  feedbackAt: z.string().optional().nullable(),
  trackingNo: z.string().optional().nullable(),
  feeAmount: amountSchema.optional().nullable(),
  result: z.nativeEnum(SampleRoundResult).optional(),
  feedback: z.string().optional().nullable(),
  improvements: z.string().optional().nullable(),
});

export type SampleRoundInput = z.infer<typeof roundSchema>;

const createSchema = z.object({
  opportunityId: z.string().optional().nullable(),
  customerId: z.string().optional().nullable(),
  productId: z.string().optional().nullable(),
  productName: z.string().optional(),
  spec: z.string().optional().nullable(),
  craft: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  packaging: z.string().optional().nullable(),
  sampleType: z.string().optional().nullable(),
  quantity: z.number().int().optional(),
  requirement: z.string().optional().nullable(),
  targetPrice: z.string().optional().nullable(),
  status: z.nativeEnum(SampleStatus).optional(),
  feeAmount: amountSchema.optional().nullable(),
  feeCurrency: z.nativeEnum(Currency).optional(),
  feeRecoverable: z.boolean().optional(),
  ownerId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  rounds: z.array(roundSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  opportunityId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(SampleStatus).optional(),
  // 按产品过滤（additive）：命中 SampleOrder.productId；不改变 scope / 分页 / 排序
  productId: z.string().optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

/** 轮次入参 → Prisma 写入数据（feeAmount 全程 Decimal） */
function toRoundData(
  input: SampleRoundInput,
  roundNo: number,
  userId: string | null,
): Prisma.SampleRoundUncheckedCreateWithoutSampleOrderInput {
  return {
    roundNo,
    designAt: input.designAt ? new Date(input.designAt) : null,
    moldAt: input.moldAt ? new Date(input.moldAt) : null,
    sentAt: input.sentAt ? new Date(input.sentAt) : null,
    feedbackAt: input.feedbackAt ? new Date(input.feedbackAt) : null,
    trackingNo: input.trackingNo ?? null,
    feeAmount: round(input.feeAmount ?? null, DECIMAL_PRECISION.amount),
    result: input.result ?? SampleRoundResult.PENDING,
    feedback: input.feedback ?? null,
    improvements: input.improvements ?? null,
    createdBy: userId,
  };
}

interface ProductSnapshot {
  productId: string | null;
  productName: string;
  spec: string | null;
  craft: string | null;
  size: string | null;
  packaging: string | null;
}

type SnapshotResult =
  | { ok: true; data: ProductSnapshot }
  | { ok: false; message: string };

/**
 * 产品快照解析（ADR-04）。
 *
 * 权威顺序：调用方显式传入的快照值 > Product 当前值。
 * Product 后续改名不会回溯修改已落库的 SampleOrder。
 * Product 无 `spec` / `craft` / `size` 列（仅有包装 `packaging`），故这几项只取入参，不做推断。
 */
async function resolveProductSnapshot(input: {
  productId?: string | null;
  productName?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
}): Promise<SnapshotResult> {
  let product: { id: string; name: string; packaging: string | null } | null = null;
  if (input.productId) {
    product = await prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, name: true, packaging: true },
    });
    if (!product) return { ok: false, message: '产品不存在' };
  }

  const productName = input.productName ?? product?.name;
  if (!productName) return { ok: false, message: '产品名称不能为空' };

  return {
    ok: true,
    data: {
      productId: product?.id ?? null,
      productName,
      spec: input.spec ?? null,
      craft: input.craft ?? null,
      size: input.size ?? null,
      packaging: input.packaging ?? product?.packaging ?? null,
    },
  };
}

/** 解析客户：显式 customerId 优先，否则回填商机所属客户（SampleOrder.customerId 必填） */
async function resolveCustomerId(input: {
  customerId?: string | null;
  opportunityId?: string | null;
}): Promise<{ ok: true; customerId: string } | { ok: false; message: string }> {
  if (input.customerId) return { ok: true, customerId: input.customerId };
  if (input.opportunityId) {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: input.opportunityId },
      select: { id: true, customerId: true },
    });
    if (!opportunity) return { ok: false, message: '商机不存在' };
    if (!opportunity.customerId) return { ok: false, message: '客户不能为空' };
    return { ok: true, customerId: opportunity.customerId };
  }
  return { ok: false, message: '客户不能为空' };
}

/**
 * 「当前用户数据范围（ALL / DEPT / SELF）+ id」的查询条件。
 * 所有打样单 / 轮次读写都必须经此条件，杜绝越权访问。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId' }));
}

// ============ 列表 ============
export const listSampleOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    let where: Record<string, unknown> = {};
    if (query.opportunityId) where.opportunityId = query.opportunityId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.keyword) {
      where.OR = [{ sampleNo: { contains: query.keyword } }, { productName: { contains: query.keyword } }];
    }

    // 数据范围：ALL / DEPT / SELF（ownerId）；SampleOrder 不存在公海语义，不并入 publicSea
    where = applyScope(where, await roleScope(req, { field: 'ownerId' }));

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.sampleOrder.findMany({
        where,
        include: SAMPLE_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.sampleOrder.count({ where }),
    ]);
    success(res, { list, total, page: pageNum, pageSize: pageSizeNum });
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情 ============
export const getSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: SAMPLE_ORDER_DETAIL_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '打样单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（可同时带初始轮次） ============
export const createSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const resolved = await resolveCustomerId(body);
    if (!resolved.ok) {
      fail(res, 400, resolved.message);
      return;
    }
    const customerId = resolved.customerId;
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      fail(res, 400, '客户不存在');
      return;
    }

    if (body.opportunityId) {
      const opportunity = await prisma.opportunity.findUnique({
        where: { id: body.opportunityId },
        select: { id: true },
      });
      if (!opportunity) {
        fail(res, 400, '商机不存在');
        return;
      }
    }

    const snapshot = await resolveProductSnapshot(body);
    if (!snapshot.ok) {
      fail(res, 400, snapshot.message);
      return;
    }

    const rounds = (body.rounds ?? []).map((r, index) =>
      toRoundData(r, index + 1, req.userId ?? null),
    );
    const feeAmount = round(body.feeAmount ?? null, DECIMAL_PRECISION.amount);

    // D-C4-B（Option B，CREATE）：显式指定业务归属时，目标用户必须在本用户数据范围内
    // （ALL/admin → 任意合法用户；DEPT → 本部门及下级成员；SELF → 仅本人）。
    // 未提供（undefined / null）时下方 `?? req.userId` 归当前用户，不进入显式校验。
    if (body.ownerId !== undefined && body.ownerId !== null) {
      const owner = await prisma.user.findFirst({
        where: applyScope({ id: body.ownerId }, await roleScope(req, { field: 'id' })),
        select: { id: true },
      });
      if (!owner) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const sampleNo = await getNextNumber(tx, 'SMP');

      return tx.sampleOrder.create({
        data: {
          sampleNo,
          customerId,
          opportunityId: body.opportunityId ?? null,
          productId: snapshot.data.productId,
          productName: snapshot.data.productName,
          spec: snapshot.data.spec,
          craft: snapshot.data.craft,
          size: snapshot.data.size,
          packaging: snapshot.data.packaging,
          sampleType: body.sampleType ?? null,
          quantity: body.quantity ?? 1,
          requirement: body.requirement ?? null,
          targetPrice: body.targetPrice ?? null,
          status: body.status ?? SampleStatus.DRAFT,
          currentRound: rounds.length > 0 ? rounds[rounds.length - 1].roundNo : 1,
          feeAmount,
          feeCurrency: body.feeCurrency ?? Currency.USD,
          feeRecoverable: body.feeRecoverable ?? false,
          ownerId: body.ownerId ?? req.userId ?? null,
          notes: body.notes ?? null,
          createdBy: req.userId ?? null,
          ...(rounds.length > 0 ? { rounds: { create: rounds } } : {}),
        },
        include: SAMPLE_ORDER_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: item.id,
      businessNo: item.sampleNo,
      summary: `${req.username ?? ''} 创建了打样单「${item.sampleNo}」（${item.productName}）`,
      ip: req.ip,
      customerId,
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（局部更新，不触历史轮次） ============
export const updateSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, id),
      select: {
        id: true,
        sampleNo: true,
        customerId: true,
        productId: true,
        productName: true,
        spec: true,
        craft: true,
        size: true,
        packaging: true,
      },
    });
    if (!existing) {
      fail(res, 404, '打样单不存在');
      return;
    }

    const data: Prisma.SampleOrderUpdateInput = {};

    if (rest.customerId !== undefined) {
      if (!rest.customerId) {
        fail(res, 400, '客户不能为空');
        return;
      }
      const customer = await prisma.customer.findUnique({
        where: { id: rest.customerId },
        select: { id: true },
      });
      if (!customer) {
        fail(res, 400, '客户不存在');
        return;
      }
      data.customer = { connect: { id: rest.customerId } };
    }
    if (rest.opportunityId !== undefined) {
      if (rest.opportunityId) {
        const opportunity = await prisma.opportunity.findUnique({
          where: { id: rest.opportunityId },
          select: { id: true },
        });
        if (!opportunity) {
          fail(res, 400, '商机不存在');
          return;
        }
        data.opportunity = { connect: { id: rest.opportunityId } };
      } else {
        data.opportunity = { disconnect: true };
      }
    }

    // 产品字段任一变化 → 以「入参 > 已有快照值」重新生成快照（Product 本身不被修改）
    const productTouched =
      rest.productId !== undefined ||
      rest.productName !== undefined ||
      rest.spec !== undefined ||
      rest.craft !== undefined ||
      rest.size !== undefined ||
      rest.packaging !== undefined;
    if (productTouched) {
      const snapshot = await resolveProductSnapshot({
        productId: rest.productId !== undefined ? rest.productId : existing.productId,
        productName: rest.productName !== undefined ? rest.productName : existing.productName,
        spec: rest.spec !== undefined ? rest.spec : existing.spec,
        craft: rest.craft !== undefined ? rest.craft : existing.craft,
        size: rest.size !== undefined ? rest.size : existing.size,
        packaging: rest.packaging !== undefined ? rest.packaging : existing.packaging,
      });
      if (!snapshot.ok) {
        fail(res, 400, snapshot.message);
        return;
      }
      data.product = snapshot.data.productId
        ? { connect: { id: snapshot.data.productId } }
        : { disconnect: true };
      data.productName = snapshot.data.productName;
      data.spec = snapshot.data.spec;
      data.craft = snapshot.data.craft;
      data.size = snapshot.data.size;
      data.packaging = snapshot.data.packaging;
    }

    if (rest.sampleType !== undefined) data.sampleType = rest.sampleType;
    if (rest.quantity !== undefined) data.quantity = rest.quantity;
    if (rest.requirement !== undefined) data.requirement = rest.requirement;
    if (rest.targetPrice !== undefined) data.targetPrice = rest.targetPrice;
    if (rest.status !== undefined) data.status = rest.status;
    if (rest.feeAmount !== undefined) {
      data.feeAmount = round(rest.feeAmount, DECIMAL_PRECISION.amount);
    }
    if (rest.feeCurrency !== undefined) data.feeCurrency = rest.feeCurrency;
    if (rest.feeRecoverable !== undefined) data.feeRecoverable = rest.feeRecoverable;
    // D-C4-B（Option B，UPDATE）：改派归属必须通过数据范围校验，且**先于任何写入**。
    // SampleOrder **无公海语义**，故 `null`（含 ''）一律拒绝。
    if (rest.ownerId !== undefined) {
      if (
        rest.ownerId === null ||
        rest.ownerId === '' ||
        !(await prisma.user.findFirst({
          where: applyScope({ id: rest.ownerId }, await roleScope(req, { field: 'id' })),
          select: { id: true },
        }))
      ) {
        fail(res, 400, '业务归属人不存在或无权限指派');
        return;
      }
    }
    if (rest.ownerId !== undefined) data.ownerId = rest.ownerId;
    if (rest.notes !== undefined) data.notes = rest.notes;
    data.updatedBy = req.userId ?? null;

    const item = await prisma.sampleOrder.update({
      where: { id },
      data,
      include: SAMPLE_ORDER_INCLUDE,
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: item.id,
      businessNo: item.sampleNo,
      summary: `${req.username ?? ''} 更新了打样单「${item.sampleNo}」`,
      ip: req.ip,
      customerId: item.customerId,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除（物理删除；rounds 由 schema Cascade 联动删除） ============
export const removeSampleOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, sampleNo: true, customerId: true, productName: true },
    });
    if (!existing) {
      fail(res, 404, '打样单不存在');
      return;
    }

    await prisma.sampleOrder.delete({ where: { id: existing.id } });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: existing.id,
      businessNo: existing.sampleNo,
      summary: `${req.username ?? ''} 删除了打样单「${existing.sampleNo}」`,
      ip: req.ip,
      customerId: existing.customerId,
    });

    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 轮次：列表 ============
export const listSampleRounds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, currentRound: true },
    });
    if (!order) {
      fail(res, 404, '打样单不存在');
      return;
    }
    const rounds = await prisma.sampleRound.findMany({
      where: { sampleOrderId: order.id },
      orderBy: { roundNo: 'asc' },
    });
    success(res, { list: rounds, currentRound: order.currentRound });
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 轮次：新建（roundNo 自增，currentRound 同步） ============
export const createSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = roundSchema.parse(req.body);
    const order = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, sampleNo: true, customerId: true },
    });
    if (!order) {
      fail(res, 404, '打样单不存在');
      return;
    }

    const createdRound = await prisma.$transaction(async (tx) => {
      const max = await tx.sampleRound.aggregate({
        where: { sampleOrderId: order.id },
        _max: { roundNo: true },
      });
      const roundNo = (max._max.roundNo ?? 0) + 1;
      const roundRow = await tx.sampleRound.create({
        data: {
          ...toRoundData(input, roundNo, req.userId ?? null),
          sampleOrderId: order.id,
        },
      });
      await tx.sampleOrder.update({
        where: { id: order.id },
        data: { currentRound: roundNo, updatedBy: req.userId ?? null },
      });
      return roundRow;
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: order.id,
      businessNo: order.sampleNo,
      summary: `${req.username ?? ''} 为打样单「${order.sampleNo}」新增第 ${createdRound.roundNo} 轮`,
      ip: req.ip,
      customerId: order.customerId,
    });

    created(res, createdRound);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      fail(res, 409, '轮次号冲突，请重试');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 轮次：更新（仅改指定轮次，不影响其他历史轮次） ============
export const updateSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const input = roundSchema.parse(req.body);
    const order = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, sampleNo: true, customerId: true },
    });
    if (!order) {
      fail(res, 404, '打样单不存在');
      return;
    }

    const roundRow = await prisma.sampleRound.findFirst({
      where: { id: req.params.roundId, sampleOrderId: order.id },
      select: { id: true, roundNo: true },
    });
    if (!roundRow) {
      fail(res, 404, '打样轮次不存在');
      return;
    }

    const data: Prisma.SampleRoundUpdateInput = {};
    if (input.designAt !== undefined) data.designAt = input.designAt ? new Date(input.designAt) : null;
    if (input.moldAt !== undefined) data.moldAt = input.moldAt ? new Date(input.moldAt) : null;
    if (input.sentAt !== undefined) data.sentAt = input.sentAt ? new Date(input.sentAt) : null;
    if (input.feedbackAt !== undefined) {
      data.feedbackAt = input.feedbackAt ? new Date(input.feedbackAt) : null;
    }
    if (input.trackingNo !== undefined) data.trackingNo = input.trackingNo;
    if (input.feeAmount !== undefined) {
      data.feeAmount = round(input.feeAmount, DECIMAL_PRECISION.amount);
    }
    if (input.result !== undefined) data.result = input.result;
    if (input.feedback !== undefined) data.feedback = input.feedback;
    if (input.improvements !== undefined) data.improvements = input.improvements;

    const updated = await prisma.sampleRound.update({ where: { id: roundRow.id }, data });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: order.id,
      businessNo: order.sampleNo,
      summary: `${req.username ?? ''} 更新了打样单「${order.sampleNo}」第 ${updated.roundNo} 轮`,
      ip: req.ip,
      customerId: order.customerId,
    });

    success(res, updated, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 轮次：删除（仅删指定轮次；currentRound 重算，不指向不存在的轮次） ============
export const removeSampleRound = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await prisma.sampleOrder.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, sampleNo: true, customerId: true },
    });
    if (!order) {
      fail(res, 404, '打样单不存在');
      return;
    }

    const roundRow = await prisma.sampleRound.findFirst({
      where: { id: req.params.roundId, sampleOrderId: order.id },
      select: { id: true, roundNo: true },
    });
    if (!roundRow) {
      fail(res, 404, '打样轮次不存在');
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.sampleRound.delete({ where: { id: roundRow.id } });
      const max = await tx.sampleRound.aggregate({
        where: { sampleOrderId: order.id },
        _max: { roundNo: true },
      });
      await tx.sampleOrder.update({
        where: { id: order.id },
        data: { currentRound: max._max.roundNo ?? 1, updatedBy: req.userId ?? null },
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'sales',
      businessType: BUSINESS_TYPE.SAMPLE_ORDER,
      businessId: order.id,
      businessNo: order.sampleNo,
      summary: `${req.username ?? ''} 删除了打样单「${order.sampleNo}」第 ${roundRow.roundNo} 轮`,
      ip: req.ip,
      customerId: order.customerId,
    });

    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
