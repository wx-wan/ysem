import {
  Currency,
  InspectionResult,
  Prisma,
  SalesOrderStatus,
  ShipmentStatus,
} from '@prisma/client';
import { z } from 'zod';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  createShipmentAggregate,
  updateShipmentAggregate,
  type AssertPreShipmentQcPassed,
  type AssertQuantityEligible,
  type AssertShippable,
  type ShipmentLineRow,
} from '../operations/shipment.operations';
import {
  customerRepository,
  salesOrderRepository,
  shipmentRepository,
} from '../repositories';
import { checkShipmentStatusTransition } from '../state';
import { DECIMAL_PRECISION, round } from '../utils/currency';
import { applyScope } from '../scope';
import type { SalesActorContext } from './salesProcess.shared';

/**
 * Shipment Business Layer —— Round R-5 · Phase 4 · D1-c 出运域
 *
 * 履约链：SalesOrder → Shipment（分批发货）→ ShipmentItem[]
 *  - Shipment 是唯一的正式出运单实体，**不得**回退到 Order(type=SHIPPED)；
 *  - 明细一律落 ShipmentItem（结构化），**不得**使用 JSON 出运明细 / 旧 OrderItem；
 *  - 出运状态使用 ShipmentStatus，**不得**复用 SalesOrderStatus / 旧 Order.status；
 *  - Shipment **无 ownerId 列** → 归属经 `salesOrder.ownerId` 施加 Scope（不新增列）。
 *
 * 【出货数量权威（P0）】见 `operations/shipment.operations.ts` 文件头。
 *
 * 已 Deferred（继续不做）：审批流转、QualityInspection 业务逻辑（仅详情只读 include）、
 * Payment / Profit（`Shipment.freightAmountCny` 为 ADR-20 唯一数据源；Shipment 无 exchangeRate
 * 列 ⇒ 自动折算无法留痕 → 仅接受显式入参）、SalesOrder.status 与 Shipment 的状态同步
 * （无既定同步规则）。
 *
 * 约束：不读 req / res、不出现 `$transaction`、不直接 import Prisma 单例。
 */

// ============================================================
// DTO / 常量
// ============================================================

const amountSchema = z.union([z.number(), z.string()]);

export const shipmentItemSchema = z.object({
  salesOrderItemId: z.string().min(1, '订单明细不能为空'),
  productName: z.string().optional(),
  spec: z.string().optional().nullable(),
  quantity: amountSchema.optional(),
  packageCount: z.number().int().optional().nullable(),
  grossWeight: z.number().optional().nullable(),
  volume: z.number().optional().nullable(),
});

export const shipmentCreateSchema = z.object({
  salesOrderId: z.string().min(1, '销售订单不能为空'),
  customerId: z.string().optional().nullable(),
  status: z.nativeEnum(ShipmentStatus).optional(),
  shipmentDate: z.string().optional().nullable(),
  etd: z.string().optional().nullable(),
  eta: z.string().optional().nullable(),
  atd: z.string().optional().nullable(),
  ata: z.string().optional().nullable(),
  incoterm: z.string().optional().nullable(),
  portOfLoading: z.string().optional().nullable(),
  portOfDischarge: z.string().optional().nullable(),
  carrier: z.string().optional().nullable(),
  vessel: z.string().optional().nullable(),
  billOfLadingNo: z.string().optional().nullable(),
  trackingNo: z.string().optional().nullable(),
  shippingMethod: z.string().optional().nullable(),
  packageCount: z.number().int().optional().nullable(),
  grossWeight: z.number().optional().nullable(),
  netWeight: z.number().optional().nullable(),
  volume: z.number().optional().nullable(),
  freightAmount: amountSchema.optional().nullable(),
  freightCurrency: z.nativeEnum(Currency).optional().nullable(),
  freightAmountCny: amountSchema.optional().nullable(),
  customsDeclarationNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(shipmentItemSchema).optional(),
});

export const shipmentUpdateSchema = shipmentCreateSchema.partial().extend({
  id: z.string().min(1),
});

export const shipmentListQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(ShipmentStatus).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

export type ShipmentItemInput = z.infer<typeof shipmentItemSchema>;
export type ShipmentCreateInput = z.infer<typeof shipmentCreateSchema>;
export type ShipmentUpdateInput = Omit<z.infer<typeof shipmentUpdateSchema>, 'id'>;
export type ShipmentListQuery = z.infer<typeof shipmentListQuerySchema>;
type ShipmentBaseInput = Partial<ShipmentCreateInput>;

/** 列表统一 include：销售订单（归属经此）、客户、明细（含订单行） */
const SHIPMENT_INCLUDE = {
  salesOrder: { select: { id: true, orderNo: true, status: true, ownerId: true } },
  customer: { select: { id: true, customerNo: true, companyName: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: { salesOrderItem: { select: { id: true, lineNo: true, productName: true } } },
  },
} satisfies Prisma.ShipmentInclude;

/** 详情额外只读 include 质检（宿主 exactly-one：productionOrderId XOR shipmentId） */
const SHIPMENT_DETAIL_INCLUDE = {
  ...SHIPMENT_INCLUDE,
  inspections: { select: { id: true, inspectionNo: true, type: true, result: true } },
} satisfies Prisma.ShipmentInclude;

/**
 * 允许出货的销售订单状态白名单（Round 3C 确立的最小规则）：
 * DRAFT（未确认）/ COMPLETED（已完成）/ CANCELLED（已取消）不允许出货，其余允许（支持分批）。
 */
const SHIPPABLE_STATUSES: SalesOrderStatus[] = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.DEPOSIT_PENDING,
  SalesOrderStatus.DEPOSIT_PAID,
  SalesOrderStatus.IN_PRODUCTION,
  SalesOrderStatus.QC,
  SalesOrderStatus.READY_TO_SHIP,
  SalesOrderStatus.SHIPPED,
];

// ============================================================
// 明细解析 + 快照（纯函数）
// ============================================================

type ParseLinesResult =
  | { ok: true; lines: ShipmentLineRow[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * 出运明细解析 + 快照（ADR-04）。
 *
 * 快照权威：显式传入 > SalesOrderItem 当前值。
 * 出运不修改 Product / CustomerProduct，也不回写 SalesOrderItem 快照字段。
 * ShipmentItem 无 productId 列，产品血缘经 salesOrderItemId 传递（Schema limitation）。
 *
 * 校验顺序与迁移前逐字一致：订单明细不存在(404) → 不属于该销售订单(400)
 *   → 出货数量必须大于 0(400) → 缺少产品名称(400)。
 */
function buildLines(input: {
  raw: ShipmentItemInput[] | undefined;
  salesOrderId: string;
  salesOrderItems: ReadonlyArray<{
    id: string;
    orderId: string;
    productName: string;
    spec: string | null;
  }>;
}): ParseLinesResult {
  const { raw, salesOrderId } = input;
  if (!raw || raw.length === 0) return { ok: true, lines: [] };

  const soItemById = new Map(input.salesOrderItems.map((i) => [i.id, i]));
  const lines: ShipmentLineRow[] = [];

  for (const [index, item] of raw.entries()) {
    const soItem = soItemById.get(item.salesOrderItemId);
    if (!soItem) {
      return { ok: false, status: 404, message: `第 ${index + 1} 行明细：订单明细不存在` };
    }
    if (soItem.orderId !== salesOrderId) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细：订单明细不属于该销售订单` };
    }

    const quantity = round(item.quantity ?? null, DECIMAL_PRECISION.quantity);
    if (!quantity || quantity.lte(0)) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细出货数量必须大于 0` };
    }

    const productName = item.productName ?? soItem.productName;
    if (!productName) {
      return { ok: false, status: 400, message: `第 ${index + 1} 行明细缺少产品名称` };
    }

    lines.push({
      salesOrderItemId: soItem.id,
      productName,
      spec: item.spec ?? soItem.spec ?? null,
      quantity,
      packageCount: item.packageCount ?? null,
      grossWeight: item.grossWeight ?? null,
      volume: item.volume ?? null,
    });
  }

  return { ok: true, lines };
}

/** 加载明细解析所需数据（订单行快照来源） */
async function loadLinesInput(raw: ShipmentItemInput[] | undefined, salesOrderId: string) {
  const ids = Array.from(new Set((raw ?? []).map((i) => i.salesOrderItemId).filter((v): v is string => Boolean(v))));
  const salesOrderItems = await salesOrderRepository.findItemsByIds(ids);
  return buildLines({ raw, salesOrderId, salesOrderItems });
}

// ============================================================
// 数量 / 质检门禁（纯判定 → 以回调注入 Operation 的事务）
// ============================================================

/**
 * C-3 · 持久化出货数量门禁（Round 3C-3-E-2-I，仅 BOOKED → SHIPPED）
 *
 * 断言（逐订单行）：**本单最终量 + 其他出运单合计 ≤ SalesOrderItem.quantity**
 *
 * 为什么不能直接复用 `assertShippable`：后者语义是「本次请求量 ≤ 订单量 − 其他单已出货量」，
 * 且契约要求「在本单旧明细已删除之后调用」——只适用于**携带 items** 的路径。
 * 本函数改为「排除本单后取其他单合计，再加本单最终量」，对「items 缺席」的路径同样成立
 * （C-3 要求无条件校验持久化状态）。
 *
 * 数量权威不变：`ShipmentItem.quantity` 仍是唯一权威，本函数**只读不写**。
 * 违例 → **409**。
 */
const assertQuantityEligible: AssertQuantityEligible = ({ orderedById, ownById, otherById }) => {
  const ids = new Set([...orderedById.keys(), ...ownById.keys(), ...otherById.keys()]);
  for (const id of ids) {
    const ordered = orderedById.get(id);
    if (!ordered) throw new DomainConflictError('订单明细不存在，无法确认出货数量');
    const own = ownById.get(id) ?? new Prisma.Decimal(0);
    const other = otherById.get(id) ?? new Prisma.Decimal(0);
    const total = own.plus(other);
    if (total.gt(ordered)) {
      throw new DomainConflictError(
        `出货数量超出订单数量，无法发运（订单数量 ${ordered.toFixed()}，本单 ${own.toFixed()}，其他出运单 ${other.toFixed()}）`,
      );
    }
  }
};

/**
 * C-2 · 出运前质检门禁（仅 BOOKED → SHIPPED）
 *
 * 「有效 QC」= 该 Shipment 下按 `createdAt DESC, id DESC` 排序的**最新一条**
 * `type = PRE_SHIPMENT` 质检单，且其**当前** result === PASSED。
 *
 * 明确禁止 exists-PASSED 语义：`QC#1 PASSED → QC#2 FAILED` 必须 REJECT；
 * `CONDITIONAL ≠ PASSED`；无记录 → REJECT。只读，不联动任何状态。违例 → **409**。
 */
const assertPreShipmentQcPassed: AssertPreShipmentQcPassed = (latest) => {
  if (!latest) {
    throw new DomainConflictError('出运前质检未完成：请先为该出运单创建 PRE_SHIPMENT 质检单');
  }
  if (latest.result !== InspectionResult.PASSED) {
    throw new DomainConflictError(
      `出运前质检未通过，无法发运（最新质检单「${latest.inspectionNo}」结果为 ${latest.result}）`,
    );
  }
};

/**
 * 逐行上限判定（`assertShippable` 的实际规则体）。
 *
 * 与 C-3 的差别：本函数以「本次请求量」为被检量（调用时本单旧明细已删除，聚合基数 = 其他单），
 * C-3 以「本单最终持久化量」为被检量（无条件校验）。
 */
function judgeShippable(
  requested: Map<string, Prisma.Decimal>,
  ctx: { orderedById: Map<string, Prisma.Decimal>; shippedById: Map<string, Prisma.Decimal> },
): void {
  for (const [id, req] of requested) {
    const ordered = ctx.orderedById.get(id);
    if (!ordered) throw new DomainValidationError('订单明细不存在');
    const already = ctx.shippedById.get(id) ?? new Prisma.Decimal(0);
    const available = ordered.minus(already);
    if (req.gt(available)) {
      throw new DomainValidationError(
        `出货数量超出可出货数量（订单数量 ${ordered.toFixed()}，已出货 ${already.toFixed()}，本次请求 ${req.toFixed()}）`,
      );
    }
  }
}

/** 把「本次请求量」按订单行汇总后判定（同一下单行被多行引用时先在本请求内累计） */
function makeAssertShippable(lines: ShipmentLineRow[]): AssertShippable {
  const requested = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    requested.set(
      line.salesOrderItemId,
      (requested.get(line.salesOrderItemId) ?? new Prisma.Decimal(0)).plus(line.quantity),
    );
  }
  return (ctx) => judgeShippable(requested, ctx);
}

// ============================================================
// Scope / 基础字段
// ============================================================

/**
 * 当前用户数据范围（ALL / DEPT / SELF）。
 * Shipment 无 ownerId 列 → 归属经 `salesOrder.ownerId`（relation scope），不新增列、不并入公海。
 */
async function scopedWhere(
  ctx: SalesActorContext,
  base: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const ownerScope = await ctx.scope.owner();
  return applyScope(base, { salesOrder: ownerScope });
}

/** 出运单基础字段组装（create / update 共用；未提供的字段保持 `undefined` 以支持部分更新） */
function baseData(body: ShipmentBaseInput) {
  return {
    status: body.status,
    shipmentDate: body.shipmentDate ? new Date(body.shipmentDate) : body.shipmentDate,
    etd: body.etd ? new Date(body.etd) : body.etd,
    eta: body.eta ? new Date(body.eta) : body.eta,
    atd: body.atd ? new Date(body.atd) : body.atd,
    ata: body.ata ? new Date(body.ata) : body.ata,
    incoterm: body.incoterm,
    portOfLoading: body.portOfLoading,
    portOfDischarge: body.portOfDischarge,
    carrier: body.carrier,
    vessel: body.vessel,
    billOfLadingNo: body.billOfLadingNo,
    trackingNo: body.trackingNo,
    shippingMethod: body.shippingMethod,
    packageCount: body.packageCount,
    grossWeight: body.grossWeight,
    netWeight: body.netWeight,
    volume: body.volume,
    freightAmount: round(body.freightAmount ?? null, DECIMAL_PRECISION.amount),
    freightCurrency: body.freightCurrency,
    freightAmountCny: round(body.freightAmountCny ?? null, DECIMAL_PRECISION.amount),
    customsDeclarationNo: body.customsDeclarationNo,
    notes: body.notes,
  };
}

// ============================================================
// 列表 / 详情
// ============================================================

export async function list(query: ShipmentListQuery, ctx: SalesActorContext) {
  const where: Record<string, unknown> = {};
  if (query.salesOrderId) where.salesOrderId = query.salesOrderId;
  if (query.customerId) where.customerId = query.customerId;
  if (query.status) where.status = query.status;
  if (query.keyword) {
    where.OR = [
      { shipmentNo: { contains: query.keyword } },
      { trackingNo: { contains: query.keyword } },
      { salesOrder: { orderNo: { contains: query.keyword } } },
    ];
  }

  const scoped = (await scopedWhere(ctx, where)) as Prisma.ShipmentWhereInput;
  const pageNum = Math.max(1, Number(query.page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

  const [list, total] = await Promise.all([
    shipmentRepository.findMany({
      where: scoped,
      include: SHIPMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * pageSizeNum,
      take: pageSizeNum,
    }),
    shipmentRepository.count(scoped),
  ]);
  return { list, total, page: pageNum, pageSize: pageSizeNum };
}

export async function getOne(id: string, ctx: SalesActorContext) {
  const item = await shipmentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ShipmentWhereInput,
    include: SHIPMENT_DETAIL_INCLUDE,
  });
  if (!item) throw new DomainNotFoundError('出运单不存在');
  return item;
}

// ============================================================
// 新建
// ============================================================

export async function create(body: ShipmentCreateInput, ctx: SalesActorContext) {
  // V1.0 可见性边界（F-01 / D-E2-H）：查询对象是 **SalesOrder 自身**，`ownerId` 为其直接字段
  // ⇒ 使用**无 relation** 的 scope（Shipment 形态的 `relation: 'salesOrder'` 会把条件写到本模型
  // 不存在的路径上）。不可见与不存在统一 404（不向 SELF / DEPT 用户泄露存在性）。
  const salesOrder = await salesOrderRepository.findFirst({
    where: applyScope({ id: body.salesOrderId }, await ctx.scope.owner()) as Prisma.SalesOrderWhereInput,
    select: { id: true, orderNo: true, status: true, customerId: true },
  });
  if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');
  if (!SHIPPABLE_STATUSES.includes(salesOrder.status)) {
    throw new DomainValidationError(`销售订单当前状态（${salesOrder.status}）不允许出货`);
  }

  const customerId = body.customerId ?? salesOrder.customerId;
  if (!customerId) throw new DomainValidationError('客户不能为空');
  if (customerId !== salesOrder.customerId) {
    throw new DomainValidationError('客户与销售订单所属客户不一致');
  }
  const customer = await customerRepository.findFirst({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new DomainValidationError('客户不存在');

  const parsed = await loadLinesInput(body.items, salesOrder.id);
  if (!parsed.ok) {
    throw parsed.status === 404 ? new DomainNotFoundError(parsed.message) : new DomainValidationError(parsed.message);
  }

  const data = baseData(body);

  let item;
  try {
    item = await createShipmentAggregate({
      lines: parsed.lines,
      base: {
        salesOrderId: salesOrder.id,
        customerId,
        status: data.status ?? ShipmentStatus.DRAFT,
        shipmentDate: data.shipmentDate ?? null,
        etd: data.etd ?? null,
        eta: data.eta ?? null,
        atd: data.atd ?? null,
        ata: data.ata ?? null,
        incoterm: data.incoterm ?? null,
        portOfLoading: data.portOfLoading ?? null,
        portOfDischarge: data.portOfDischarge ?? null,
        carrier: data.carrier ?? null,
        vessel: data.vessel ?? null,
        billOfLadingNo: data.billOfLadingNo ?? null,
        trackingNo: data.trackingNo ?? null,
        shippingMethod: data.shippingMethod ?? null,
        packageCount: data.packageCount ?? null,
        grossWeight: data.grossWeight ?? null,
        netWeight: data.netWeight ?? null,
        volume: data.volume ?? null,
        freightAmount: data.freightAmount,
        freightCurrency: data.freightCurrency ?? null,
        freightAmountCny: data.freightAmountCny,
        customsDeclarationNo: data.customsDeclarationNo ?? null,
        notes: data.notes ?? null,
        createdBy: ctx.userId ?? null,
      },
      assertShippable: makeAssertShippable(parsed.lines),
      include: SHIPMENT_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new DomainConflictError('出运单号冲突，请重试');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'CREATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.SHIPMENT,
    businessId: item.id,
    businessNo: item.shipmentNo,
    summary: `${ctx.username ?? ''} 创建了出运单「${item.shipmentNo}」（来源订单 ${salesOrder.orderNo}）`,
    ip: ctx.ip,
    customerId,
  });

  return item;
}

// ============================================================
// 更新（先删旧明细 → 上限校验 → Eligibility Gate → 重建 → 重算）
// ============================================================

export async function update(id: string, rest: ShipmentUpdateInput, ctx: SalesActorContext) {
  const existing = await shipmentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ShipmentWhereInput,
    // status：状态转移 Gate 所需（scope 通过后才读取）
    select: { id: true, shipmentNo: true, salesOrderId: true, customerId: true, status: true },
  });
  if (!existing) throw new DomainNotFoundError('出运单不存在');
  if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
    throw new DomainValidationError('不支持修改所属销售订单，请重建出运单');
  }
  if (rest.customerId !== undefined && rest.customerId !== existing.customerId) {
    throw new DomainValidationError('不支持修改所属客户，请重建出运单');
  }

  // ---- 状态转移 Gate（Round 3C-3-E-1：scope 已通过，此处仅判定「该转换是否合法」）----
  // 必须在任何写入之前完成（早于事务与 data.status），同状态为幂等 no-op。
  if (rest.status !== undefined) {
    const gate = checkShipmentStatusTransition(existing.status, rest.status);
    if (!gate.ok) throw new DomainConflictError(gate.message);
  }

  // ---- 业务变更判定（Round 3C-3-E-2-I / D-E2-G / C-1）----
  //   α  `items` 出现        → 履约数量 / 履约内容变更
  //   β  BOOKED → SHIPPED    → 真正的发运转换
  // 仅这两种情况执行 SalesOrder Eligibility。纯物流 / 时间 / 费用 / 装载描述 / 备注字段的
  // 修正**不执行**本检查 —— 否则 SalesOrder 进入 COMPLETED / CANCELLED 后将形成
  // 「无法修正物流信息」的系统死路（C-1 明确禁止无条件 assertSalesOrderShippable）。
  const hasItemsMutation = rest.items !== undefined;
  const isBookedToShipped =
    existing.status === ShipmentStatus.BOOKED && rest.status === ShipmentStatus.SHIPPED;

  if (hasItemsMutation || isBookedToShipped) {
    // F-3C4-02（对齐 create）：宿主 SalesOrder 必须在本用户数据范围内；
    // scope 外与不存在同响应 404（select 仅 id/status，不扩大）。
    const salesOrder = await salesOrderRepository.findFirst({
      where: applyScope({ id: existing.salesOrderId }, await ctx.scope.owner()) as Prisma.SalesOrderWhereInput,
      select: { id: true, status: true },
    });
    if (!salesOrder) throw new DomainNotFoundError('销售订单不存在');
    // 沿用既有 SalesOrder SHIPPABLE 规则：**保持原有 400**（R-3(c) 冻结，不改既有语义）
    if (!SHIPPABLE_STATUSES.includes(salesOrder.status)) {
      throw new DomainValidationError(`销售订单当前状态（${salesOrder.status}）不允许出货`);
    }
  }

  let parsedLines: ShipmentLineRow[] | null = null;
  if (rest.items !== undefined) {
    const parsed = await loadLinesInput(rest.items, existing.salesOrderId);
    if (!parsed.ok) {
      throw parsed.status === 404
        ? new DomainNotFoundError(parsed.message)
        : new DomainValidationError(parsed.message);
    }
    parsedLines = parsed.lines;
  }

  const data = baseData(rest);

  let item;
  try {
    item = await updateShipmentAggregate({
      id: existing.id,
      lines: parsedLines,
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(rest.shipmentDate !== undefined ? { shipmentDate: data.shipmentDate ?? null } : {}),
        ...(rest.etd !== undefined ? { etd: data.etd ?? null } : {}),
        ...(rest.eta !== undefined ? { eta: data.eta ?? null } : {}),
        ...(rest.atd !== undefined ? { atd: data.atd ?? null } : {}),
        ...(rest.ata !== undefined ? { ata: data.ata ?? null } : {}),
        ...(rest.incoterm !== undefined ? { incoterm: data.incoterm ?? null } : {}),
        ...(rest.portOfLoading !== undefined ? { portOfLoading: data.portOfLoading ?? null } : {}),
        ...(rest.portOfDischarge !== undefined ? { portOfDischarge: data.portOfDischarge ?? null } : {}),
        ...(rest.carrier !== undefined ? { carrier: data.carrier ?? null } : {}),
        ...(rest.vessel !== undefined ? { vessel: data.vessel ?? null } : {}),
        ...(rest.billOfLadingNo !== undefined ? { billOfLadingNo: data.billOfLadingNo ?? null } : {}),
        ...(rest.trackingNo !== undefined ? { trackingNo: data.trackingNo ?? null } : {}),
        ...(rest.shippingMethod !== undefined ? { shippingMethod: data.shippingMethod ?? null } : {}),
        ...(rest.packageCount !== undefined ? { packageCount: data.packageCount ?? null } : {}),
        ...(rest.grossWeight !== undefined ? { grossWeight: data.grossWeight ?? null } : {}),
        ...(rest.netWeight !== undefined ? { netWeight: data.netWeight ?? null } : {}),
        ...(rest.volume !== undefined ? { volume: data.volume ?? null } : {}),
        ...(rest.freightAmount !== undefined ? { freightAmount: data.freightAmount } : {}),
        ...(rest.freightCurrency !== undefined ? { freightCurrency: data.freightCurrency ?? null } : {}),
        ...(rest.freightAmountCny !== undefined ? { freightAmountCny: data.freightAmountCny } : {}),
        ...(rest.customsDeclarationNo !== undefined
          ? { customsDeclarationNo: data.customsDeclarationNo ?? null }
          : {}),
        ...(rest.notes !== undefined ? { notes: data.notes ?? null } : {}),
        updatedBy: ctx.userId ?? null,
      },
      assertShippable: parsedLines ? makeAssertShippable(parsedLines) : makeAssertShippable([]),
      eligibility: isBookedToShipped
        ? { assertQuantityEligible, assertQcPassed: assertPreShipmentQcPassed }
        : null,
      include: SHIPMENT_INCLUDE,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new DomainConflictError('出运单存在下游单据引用，无法修改');
    }
    throw e;
  }

  void activityLogger.log({
    userId: ctx.userId ?? '',
    username: ctx.username ?? '',
    realName: ctx.realName,
    action: 'UPDATE',
    module: 'fulfillment',
    businessType: BUSINESS_TYPE.SHIPMENT,
    businessId: item.id,
    businessNo: item.shipmentNo,
    summary: `${ctx.username ?? ''} 更新了出运单「${item.shipmentNo}」`,
    ip: ctx.ip,
    customerId: item.customerId,
  });

  return item;
}

// ============================================================
// 删除（V1.0：**禁止物理删除**，统一 409）
// ============================================================

/**
 * V1.0（D-E4-D / D-E4-E = E1 / D-E4-F · Q9 / ADR-08）：
 * Shipment 属业务单据，**全部状态（含 DRAFT）一律禁止物理删除**；不软删除；
 * 生命周期以状态表达。废弃路径 = `DRAFT → CANCELLED`
 *（D-E4-C = SEMANTIC-A 生效后，作废即在同一事务内归还可出货量）。
 *
 * 因此本函数**不执行** lock / delete / recalc，也**不记录** DELETE 活动日志；
 * 可见性判定保持在 scope 层 → 不可见 / 不存在仍为 404（不泄露存在性）。
 */
export async function remove(id: string, ctx: SalesActorContext): Promise<void> {
  const existing = await shipmentRepository.findFirst({
    where: (await scopedWhere(ctx, { id })) as Prisma.ShipmentWhereInput,
    select: { id: true },
  });
  if (!existing) throw new DomainNotFoundError('出运单不存在');
  throw new DomainConflictError('出运单不允许删除，请改用「作废」（状态置为 CANCELLED）');
}
