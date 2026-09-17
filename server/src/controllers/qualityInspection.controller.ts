import { Response } from 'express';
import { z } from 'zod';
import { InspectionResult, InspectionType, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DECIMAL_PRECISION, round } from '../utils/currency';

// ============================================================
// 质检领域（V1.0）
//
// QualityInspection 是独立实体，宿主 **exactly-one**：ProductionOrder 或 Shipment。
//  - DB 侧已有 `quality_inspection_exactly_one_owner_ck`（baseline migration），本轮不新增 CHECK。
//  - 应用层必须再次强制 exactly-one owner + 宿主存在性。
//  - 统一使用 V1.0 QualityInspection（**不得**回退到旧 Order / OrderItem）。
//
// 【Schema 事实（勿臆造）】
//  - 状态枚举为 `InspectionType`（INCOMING / IN_PRODUCTION / FINAL / PRE_SHIPMENT，**required 无默认**）
//    与 `InspectionResult`（PENDING / PASSED / FAILED / CONDITIONAL，@default(PENDING)）；
//    **不存在** `QualityInspectionStatus`。
//  - **无 `customerId` 列、无 `ownerId` 列** —— 不新增；客户经宿主派生（仅用于日志，不落库）。
//  - 数量为 `Int?`（sampleQty / defectQty）；`defectRate` 为 `Decimal?(9,4)` 百分数语义。
//
// 【Scope】宿主继承，双路 OR：
//    ProductionOrder.ownerId  OR  Shipment → SalesOrder.ownerId
//    （未新增 ownerId 列；未修改 utils/scope.ts；不使用公海语义）
//
// 已 Deferred（不在本轮）：
//  - inspectionNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法）
//  - defectRate 自动计算规则未定 → 仅接受显式入参（不臆造 pass rate / defect rate 规则）
//  - QC 驱动的状态同步（ProductionOrder / Shipment / SalesOrder 一律**不**自动改状态）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - inspectorId 为无 FK 软引用，本轮不做存在性校验
// ============================================================

/** 列表 / 详情统一 include：双宿主（仅取最小业务字段） */
const QUALITY_INSPECTION_INCLUDE: Prisma.QualityInspectionInclude = {
  productionOrder: { select: { id: true, productionNo: true, status: true, ownerId: true } },
  shipment: {
    select: {
      id: true,
      shipmentNo: true,
      status: true,
      customerId: true,
      salesOrder: { select: { id: true, orderNo: true } },
    },
  },
};

/** 数值入参：JSON number 或 string，一律经 Decimal 归一 */
const amountSchema = z.union([z.number(), z.string()]);

const createSchema = z.object({
  type: z.nativeEnum(InspectionType),
  productionOrderId: z.string().optional().nullable(),
  shipmentId: z.string().optional().nullable(),
  result: z.nativeEnum(InspectionResult).optional(),
  inspectionDate: z.string().optional().nullable(),
  inspectorId: z.string().optional().nullable(),
  inspectorName: z.string().optional().nullable(),
  sampleQty: z.number().int().min(0).optional().nullable(),
  defectQty: z.number().int().min(0).optional().nullable(),
  defectRate: amountSchema.optional().nullable(),
  defectSummary: z.string().optional().nullable(),
  disposition: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  productionOrderId: z.string().optional(),
  shipmentId: z.string().optional(),
  type: z.nativeEnum(InspectionType).optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

interface ResolvedOwner {
  productionOrderId: string | null;
  shipmentId: string | null;
  /** 宿主派生客户（仅用于 OperationLog / CustomerActivity，**不落库**） */
  customerId: string | null;
}

type ResolveOwnerResult =
  | { ok: true; owner: ResolvedOwner }
  | { ok: false; status: 400 | 404; message: string };

/**
 * exactly-one owner + 宿主存在性（应用层强制，DB CHECK 为最后防线）。
 *
 * ProductionOrder 宿主 → customer 经 ProductionOrder.salesOrder.customerId 派生
 * Shipment 宿主        → customer 取 Shipment.customerId
 * 两个宿主同时存在 / 同时缺失 → 400（即使两者属于同一 SalesOrder 也拒绝，符合 schema exactly-one 语义）
 */
async function resolveOwner(
  req: AuthRequest,
  input: {
    productionOrderId?: string | null;
    shipmentId?: string | null;
  },
): Promise<ResolveOwnerResult> {
  const productionOrderId = input.productionOrderId ?? null;
  const shipmentId = input.shipmentId ?? null;

  if (productionOrderId && shipmentId) {
    return {
      ok: false,
      status: 400,
      message: '质检单必须且只能关联生产工单或出运单之一',
    };
  }
  if (!productionOrderId && !shipmentId) {
    return { ok: false, status: 400, message: '质检单必须关联生产工单或出运单' };
  }

  if (productionOrderId) {
    // F-02-B（D-E2-H）：ProductionOrder 宿主 → ProductionOrder.ownerId（**直接字段，无 relation**）
    // host 的不可见与不存在统一 404，不泄露存在性（与 list / get 的 scopedWhere 口径一致）
    const productionOrder = await prisma.productionOrder.findFirst({
      where: applyScope({ id: productionOrderId }, await roleScope(req, { field: 'ownerId' })),
      select: { id: true, salesOrder: { select: { customerId: true } } },
    });
    if (!productionOrder) {
      return { ok: false, status: 404, message: '生产工单不存在' };
    }
    return {
      ok: true,
      owner: {
        productionOrderId: productionOrder.id,
        shipmentId: null,
        customerId: productionOrder.salesOrder?.customerId ?? null,
      },
    };
  }

  // F-02-A（D-E2-H）：Shipment 宿主 → Shipment → SalesOrder.ownerId（Shipment 自身无 ownerId）
  // 因此必须带 `relation: 'salesOrder'`。不可见与不存在统一 404。
  const shipment = await prisma.shipment.findFirst({
    where: applyScope(
      { id: shipmentId as string },
      await roleScope(req, { field: 'ownerId', relation: 'salesOrder' }),
    ),
    select: { id: true, customerId: true },
  });
  if (!shipment) {
    return { ok: false, status: 404, message: '出运单不存在' };
  }
  return {
    ok: true,
    owner: { productionOrderId: null, shipmentId: shipment.id, customerId: shipment.customerId },
  };
}

/**
 * 数据范围（ALL / DEPT / SELF）—— 双宿主 OR 继承，不新增 ownerId、不使用公海：
 *   OR [ { productionOrder: { ownerId: <scope> } }, { shipment: { salesOrder: { ownerId: <scope> } } } ]
 * 复用 roleScope 的公开能力（field 级 scope）再 rebase 到各自 relation 路径，
 * 因此**无需**修改 utils/scope.ts，也无需多级 relation 支持。
 */
async function scopedWhere(
  req: AuthRequest,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const ownerScope = await roleScope(req, { field: 'ownerId' });
  if (Object.keys(ownerScope).length === 0) return base; // ALL / admin：不加条件
  const hostCond = {
    OR: [{ productionOrder: ownerScope }, { shipment: { salesOrder: ownerScope } }],
  };
  return applyScope(base, hostCond);
}

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ============ 列表 ============
export const listQualityInspections = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    const base: Record<string, unknown> = {};
    if (query.productionOrderId) base.productionOrderId = query.productionOrderId;
    if (query.shipmentId) base.shipmentId = query.shipmentId;
    if (query.type) base.type = query.type;
    if (query.result) base.result = query.result;
    if (query.keyword) base.inspectionNo = { contains: query.keyword };

    const where = await scopedWhere(req, base);

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.qualityInspection.findMany({
        where,
        include: QUALITY_INSPECTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.qualityInspection.count({ where }),
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
export const getQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.qualityInspection.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      include: QUALITY_INSPECTION_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '质检单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建 ============
export const createQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const resolved = await resolveOwner(req, body);
    if (!resolved.ok) {
      fail(res, resolved.status, resolved.message);
      return;
    }
    const { owner } = resolved;

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const item = await prisma.$transaction(async (tx) => {
      const inspectionNo = await getNextNumber(tx, 'INS');

      return tx.qualityInspection.create({
        data: {
          inspectionNo,
          type: body.type,
          productionOrderId: owner.productionOrderId,
          shipmentId: owner.shipmentId,
          result: body.result ?? InspectionResult.PENDING,
          inspectionDate: body.inspectionDate ? new Date(body.inspectionDate) : null,
          inspectorId: body.inspectorId ?? null,
          inspectorName: body.inspectorName ?? null,
          sampleQty: body.sampleQty ?? null,
          defectQty: body.defectQty ?? null,
          // defectRate：Decimal(9,4) 百分数语义；仅接受显式入参（不臆造自动计算规则）
          defectRate: round(body.defectRate ?? null, DECIMAL_PRECISION.ratio),
          defectSummary: body.defectSummary ?? null,
          disposition: body.disposition ?? null,
          notes: body.notes ?? null,
          createdBy: req.userId ?? null,
        },
        include: QUALITY_INSPECTION_INCLUDE,
      });
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.QUALITY_INSPECTION,
      businessId: item.id,
      businessNo: item.inspectionNo,
      summary: `${req.username ?? ''} 创建了质检单「${item.inspectionNo}」（${item.type}）`,
      ip: req.ip,
      // 客户经宿主派生；派生失败则仅落 OperationLog（不猜）
      ...(owner.customerId ? { customerId: owner.customerId } : {}),
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '质检单号冲突，请重试');
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '质检单宿主关系冲突');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新 ============
export const updateQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.qualityInspection.findFirst({
      where: await scopedWhere(req, { id }),
      select: {
        id: true,
        inspectionNo: true,
        type: true,
        productionOrderId: true,
        shipmentId: true,
        // F-07：append-only 结论判定需要现有 result
        result: true,
      },
    });
    if (!existing) {
      fail(res, 404, '质检单不存在');
      return;
    }

    // ---- Append-Only 结论 · 不可变字段（F-07 / D-E4-B · AMBIGUITY-1 = α change-based）----
    // 仅当 PATCH 中的值与数据库现值**发生实际变化**时，才构成 immutable violation；
    // 同值 PATCH 视为幂等 no-op（与 3C-3-E-1「同状态 = no-op」口径一致）。
    // 判定必须先于 resolveOwner，避免为明显的非法变更做多余的宿主解析。
    if (rest.type !== undefined && rest.type !== existing.type) {
      fail(res, 409, '质检单类型创建后不可变更');
      return;
    }
    if (
      rest.productionOrderId !== undefined &&
      rest.productionOrderId !== existing.productionOrderId
    ) {
      fail(res, 409, '质检单宿主创建后不可变更');
      return;
    }
    if (rest.shipmentId !== undefined && rest.shipmentId !== existing.shipmentId) {
      fail(res, 409, '质检单宿主创建后不可变更');
      return;
    }
    // 结论：PENDING 允许一次收敛到终值；一旦离开 PENDING 即永久冻结（不得互转、不得回退）
    if (
      rest.result !== undefined &&
      existing.result !== InspectionResult.PENDING &&
      rest.result !== existing.result
    ) {
      fail(res, 409, `质检结论已冻结，不可从 ${existing.result} 变更为 ${rest.result}`);
      return;
    }

    // 合并后的最终宿主 → 重新执行 exactly-one + 存在性校验
    // 切换宿主时必须显式置空另一侧（不自动清空，避免静默改数据）
    const resolved = await resolveOwner(req, {
      productionOrderId:
        rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId,
      shipmentId: rest.shipmentId !== undefined ? rest.shipmentId : existing.shipmentId,
    });
    if (!resolved.ok) {
      fail(res, resolved.status, resolved.message);
      return;
    }
    const { owner } = resolved;

    const data: Prisma.QualityInspectionUncheckedUpdateInput = {
      type: rest.type ?? existing.type,
      productionOrderId: owner.productionOrderId,
      shipmentId: owner.shipmentId,
      updatedBy: req.userId ?? null,
    };
    if (rest.result !== undefined) data.result = rest.result;
    if (rest.inspectionDate !== undefined) {
      data.inspectionDate = rest.inspectionDate ? new Date(rest.inspectionDate) : null;
    }
    if (rest.inspectorId !== undefined) data.inspectorId = rest.inspectorId;
    if (rest.inspectorName !== undefined) data.inspectorName = rest.inspectorName;
    if (rest.sampleQty !== undefined) data.sampleQty = rest.sampleQty;
    if (rest.defectQty !== undefined) data.defectQty = rest.defectQty;
    if (rest.defectRate !== undefined) {
      data.defectRate = round(rest.defectRate, DECIMAL_PRECISION.ratio);
    }
    if (rest.defectSummary !== undefined) data.defectSummary = rest.defectSummary;
    if (rest.disposition !== undefined) data.disposition = rest.disposition;
    if (rest.notes !== undefined) data.notes = rest.notes;

    const item = await prisma.qualityInspection.update({
      where: { id: existing.id },
      data,
      include: QUALITY_INSPECTION_INCLUDE,
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.QUALITY_INSPECTION,
      businessId: item.id,
      businessNo: item.inspectionNo,
      summary: `${req.username ?? ''} 更新了质检单「${item.inspectionNo}」`,
      ip: req.ip,
      ...(owner.customerId ? { customerId: owner.customerId } : {}),
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '质检单宿主关系冲突');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除 ============
export const removeQualityInspection = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.qualityInspection.findFirst({
      where: await scopedWhere(req, { id: req.params.id }),
      select: {
        id: true,
        inspectionNo: true,
        productionOrder: { select: { salesOrder: { select: { customerId: true } } } },
        shipment: { select: { customerId: true } },
      },
    });
    if (!existing) {
      fail(res, 404, '质检单不存在');
      return;
    }

    // V1.0（D-E4-D/E/F · Q9 / ADR-08）：QualityInspection 属业务单据，**不允许物理删除**。
    // 质检记录是历史证据（04 §5.1）：错误结论以**新增更正记录**表达，原记录永久保留。
    // 可见性判定保留在上方 scopedWhere → 不可见 / 不存在仍为 404；
    // 可见即拒绝，且**不执行** delete、**不记录** DELETE 活动日志。
    fail(res, 409, '质检记录不允许删除');
    return;
  } catch (e) {
    if (isForeignKeyError(e)) {
      fail(res, 409, '该质检单存在下游引用，无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
