import { InspectionResult, InspectionType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { createQualityInspectionAggregate } from '../operations/production.operations';
import {
  productionOrderRepository,
  qualityInspectionRepository,
  shipmentRepository,
} from '../repositories';
import { DECIMAL_PRECISION, round } from '../utils/currency';
import { applyScope } from '../scope';
import type { SalesActorContext } from './salesProcess.shared';

/**
 * QualityInspection Business Layer —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * QualityInspection 是独立实体，宿主 **exactly-one**：ProductionOrder 或 Shipment。
 *  - DB 侧已有 `quality_inspection_exactly_one_owner_ck`（baseline migration），本轮不新增 CHECK；
 *  - 应用层必须再次强制 exactly-one owner + 宿主存在性。
 *
 * 【Schema 事实（勿臆造）】
 *  - 枚举为 `InspectionType`（INCOMING / IN_PRODUCTION / FINAL / PRE_SHIPMENT，**required 无默认**）
 *    与 `InspectionResult`（PENDING / PASSED / FAILED / CONDITIONAL，@default(PENDING)）；
 *    **不存在** `QualityInspectionStatus`。
 *  - **无 `customerId` 列、无 `ownerId` 列** —— 不新增；客户经宿主派生（仅用于日志，不落库）。
 *  - 数量为 `Int?`（sampleQty / defectQty）；`defectRate` 为 `Decimal?(9,4)` 百分数语义。
 *
 * 【Scope】宿主继承，双路 OR：ProductionOrder.ownerId OR Shipment → SalesOrder.ownerId。
 *
 * 已 Deferred（继续不做）：defectRate 自动计算规则（仅接受显式入参，不臆造 pass/defect rate 规则）、
 * QC 驱动的状态同步（ProductionOrder / Shipment / SalesOrder 一律**不**自动改状态）、
 * inspectorId 为无 FK 软引用（不做存在性校验）、审批流转。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

// ============================================================
// DTO
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const qualityInspectionCreateSchema = z.object({
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

export const qualityInspectionUpdateSchema = qualityInspectionCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const qualityInspectionListQuerySchema = z.object({
  productionOrderId: z.string().optional(),
  shipmentId: z.string().optional(),
  type: z.nativeEnum(InspectionType).optional(),
  result: z.nativeEnum(InspectionResult).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type QualityInspectionCreateInput = z.infer<typeof qualityInspectionCreateSchema>;
export type QualityInspectionUpdateInput = Omit<z.infer<typeof qualityInspectionUpdateSchema>, 'id'>;
export type QualityInspectionListQuery = z.infer<typeof qualityInspectionListQuerySchema>;

/** 列表 / 详情统一 include：双宿主（仅取最小业务字段） */
const QUALITY_INSPECTION_INCLUDE = {
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
} satisfies Prisma.QualityInspectionInclude;

interface ResolvedOwner {
  productionOrderId: string | null;
  shipmentId: string | null;
  /** 宿主派生客户（仅用于 OperationLog / CustomerActivity，**不落库**） */
  customerId: string | null;
}

// ============================================================
// Scope（双宿主 OR 继承）
// ============================================================

/**
 * 数据范围（ALL / DEPT / SELF）—— 双宿主 OR 继承，不新增 ownerId、不使用公海：
 *   OR [ { productionOrder: { ownerId: <scope> } }, { shipment: { salesOrder: { ownerId: <scope> } } } ]
 * 复用 `scope.owner()`（field 级 scope）再 rebase 到各自 relation 路径，
 * 因此**无需**修改 `scope.ts`，也无需多级 relation 支持。
 */
async function scopedWhere(
  ctx: SalesActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const ownerScope = await ctx.scope.owner();
  if (Object.keys(ownerScope).length === 0) return base; // ALL / admin：不加条件
  const hostCond = {
    OR: [{ productionOrder: ownerScope }, { shipment: { salesOrder: ownerScope } }],
  };
  return applyScope(base, hostCond);
}

// ============================================================
// exactly-one owner + 宿主存在性
// ============================================================

/**
 * exactly-one owner + 宿主存在性（应用层强制，DB CHECK 为最后防线）。
 *
 * ProductionOrder 宿主 → customer 经 ProductionOrder.salesOrder.customerId 派生
 * Shipment 宿主        → customer 取 Shipment.customerId
 * 两个宿主同时存在 / 同时缺失 → 400（即使两者属于同一 SalesOrder 也拒绝，符合 schema exactly-one 语义）
 *
 * 失败态用 `{ status, message }` 返回（而非抛错）：调用方需要按 400 / 404 分别精确映射，
 * 且 update 路径需在「不可变字段判定之后」才解析宿主（避免为明显非法变更做多余解析）。
 */
async function resolveOwner(
  input: { productionOrderId?: string | null; shipmentId?: string | null },
  ctx: SalesActorContext,
): Promise<{ ok: true; owner: ResolvedOwner } | { ok: false; status: 400 | 404; message: string }> {
  const productionOrderId = input.productionOrderId ?? null;
  const shipmentId = input.shipmentId ?? null;

  if (productionOrderId && shipmentId) {
    return { ok: false, status: 400, message: '质检单必须且只能关联生产工单或出运单之一' };
  }
  if (!productionOrderId && !shipmentId) {
    return { ok: false, status: 400, message: '质检单必须关联生产工单或出运单' };
  }

  const ownerScope = await ctx.scope.owner();

  if (productionOrderId) {
    // F-02-B（D-E2-H）：ProductionOrder 宿主 → ProductionOrder.ownerId（**直接字段，无 relation**）
    // host 的不可见与不存在统一 404，不泄露存在性（与 list / get 的 scopedWhere 口径一致）
    const productionOrder = await productionOrderRepository.findFirst({
      where: applyScope({ id: productionOrderId }, ownerScope) as Prisma.ProductionOrderWhereInput,
      select: { id: true, salesOrder: { select: { customerId: true } } },
    });
    if (!productionOrder) return { ok: false, status: 404, message: '生产工单不存在' };
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
  // 因此必须把 owner scope 绑定到 `salesOrder` relation 上。不可见与不存在统一 404。
  const shipment = await shipmentRepository.findFirst({
    where: applyScope({ id: shipmentId as string }, { salesOrder: ownerScope }) as Prisma.ShipmentWhereInput,
    select: { id: true, customerId: true },
  });
  if (!shipment) return { ok: false, status: 404, message: '出运单不存在' };
  return {
    ok: true,
    owner: { productionOrderId: null, shipmentId: shipment.id, customerId: shipment.customerId },
  };
}

function hostError(result: { status: 400 | 404; message: string }): Error {
  return result.status === 404
    ? new DomainNotFoundError(result.message)
    : new DomainValidationError(result.message);
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: QualityInspectionListQuery, ctx: SalesActorContext) {
  const base: Record<string, unknown> = {};
  if (query.productionOrderId) base.productionOrderId = query.productionOrderId;
  if (query.shipmentId) base.shipmentId = query.shipmentId;
  if (query.type) base.type = query.type;
  if (query.result) base.result = query.result;
  if (query.keyword) base.inspectionNo = { contains: query.keyword };

  const where = (await scopedWhere(ctx, base)) as Prisma.QualityInspectionWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    qualityInspectionRepository.findMany({
      where,
      include: QUALITY_INSPECTION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    qualityInspectionRepository.count(where),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: SalesActorContext) {
  const item = await qualityInspectionRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.QualityInspectionWhereInput,
    include: QUALITY_INSPECTION_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('质检单不存在');
  return item;
}

// ============================================================
// 新建 / 更新
// ============================================================

export async function create(body: QualityInspectionCreateInput, ctx: SalesActorContext) {
  const resolved = await resolveOwner(body, ctx);
  if (!resolved.ok) throw hostError(resolved);
  const { owner } = resolved;

  let item;
  try {
    item = await createQualityInspectionAggregate({
      data: {
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
        createdBy: ctx.userId ?? null,
      },
      include: QUALITY_INSPECTION_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('质检单号冲突，请重试');
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('质检单宿主关系冲突');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.QUALITY_INSPECTION,
    businessId: item.id,
    businessNo: item.inspectionNo,
    summary: `${ctx.username ?? ''} 创建了质检单「${item.inspectionNo}」（${item.type}）`,
    ip: ctx.ip,
    // 客户经宿主派生；派生失败则仅落 OperationLog（不猜）
    ...(owner.customerId ? { customerId: owner.customerId } : {}),
  });

  return item;
}

export async function update(id: string, rest: QualityInspectionUpdateInput, ctx: SalesActorContext) {
  const existing = await qualityInspectionRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.QualityInspectionWhereInput,
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
  if (!existing) throw new DomainNotFoundError('质检单不存在');

  // ---- Append-Only 结论 · 不可变字段（F-07 / D-E4-B · AMBIGUITY-1 = α change-based）----
  // 仅当 PATCH 中的值与数据库现值**发生实际变化**时，才构成 immutable violation；
  // 同值 PATCH 视为幂等 no-op（与 3C-3-E-1「同状态 = no-op」口径一致）。
  // 判定必须先于 resolveOwner，避免为明显的非法变更做多余的宿主解析。
  if (rest.type !== undefined && rest.type !== existing.type) {
    throw new DomainConflictError('质检单类型创建后不可变更');
  }
  if (rest.productionOrderId !== undefined && rest.productionOrderId !== existing.productionOrderId) {
    throw new DomainConflictError('质检单宿主创建后不可变更');
  }
  if (rest.shipmentId !== undefined && rest.shipmentId !== existing.shipmentId) {
    throw new DomainConflictError('质检单宿主创建后不可变更');
  }
  // 结论：PENDING 允许一次收敛到终值；一旦离开 PENDING 即永久冻结（不得互转、不得回退）
  if (
    rest.result !== undefined &&
    existing.result !== InspectionResult.PENDING &&
    rest.result !== existing.result
  ) {
    throw new DomainConflictError(`质检结论已冻结，不可从 ${existing.result} 变更为 ${rest.result}`);
  }

  // 合并后的最终宿主 → 重新执行 exactly-one + 存在性校验
  // 切换宿主时必须显式置空另一侧（不自动清空，避免静默改数据）
  const resolved = await resolveOwner(
    {
      productionOrderId:
        rest.productionOrderId !== undefined ? rest.productionOrderId : existing.productionOrderId,
      shipmentId: rest.shipmentId !== undefined ? rest.shipmentId : existing.shipmentId,
    },
    ctx,
  );
  if (!resolved.ok) throw hostError(resolved);
  const { owner } = resolved;

  const data: Prisma.QualityInspectionUncheckedUpdateInput = {
    type: rest.type ?? existing.type,
    productionOrderId: owner.productionOrderId,
    shipmentId: owner.shipmentId,
    updatedBy: ctx.userId ?? null,
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

  let item;
  try {
    item = await qualityInspectionRepository.update({
      where: { id: existing.id },
      data,
      include: QUALITY_INSPECTION_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('质检单宿主关系冲突');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.QUALITY_INSPECTION,
    businessId: item.id,
    businessNo: item.inspectionNo,
    summary: `${ctx.username ?? ''} 更新了质检单「${item.inspectionNo}」`,
    ip: ctx.ip,
    ...(owner.customerId ? { customerId: owner.customerId } : {}),
  });

  return item;
}

// ============================================================
// 删除（业务上禁止）
// ============================================================

/**
 * V1.0（D-E4-D/E/F · Q9 / ADR-08）：QualityInspection 属业务单据，**不允许物理删除**。
 * 质检记录是历史证据（04 §5.1）：错误结论以**新增更正记录**表达，原记录永久保留。
 * 可见性判定保留在 scopedWhere → 不可见 / 不存在仍为 404；
 * 可见即拒绝（409），且**不执行** delete、**不记录** DELETE 活动日志。
 */
export async function remove(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await qualityInspectionRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.QualityInspectionWhereInput,
    select: { id: true },
  });
  if (!existing) throw new DomainNotFoundError('质检单不存在');
  throw new DomainConflictError('质检记录不允许删除');
}
