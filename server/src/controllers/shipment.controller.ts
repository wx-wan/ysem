import { Response } from 'express';
import { z } from 'zod';
import {
  Currency,
  InspectionResult,
  InspectionType,
  Prisma,
  SalesOrderStatus,
  ShipmentStatus,
} from '@prisma/client';
import prisma from '../lib/prisma';
import { getNextNumber } from '../lib/numberSequence';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';
import { applyScope, roleScope } from '../utils/scope';
import { activityLogger } from '../lib/activity-logger';
import { BUSINESS_TYPE } from '../lib/business-type';
import { DECIMAL_PRECISION, round, toDecimal } from '../utils/currency';

// ============================================================
// 出运领域（V1.0）
//
// 履约链：SalesOrder → Shipment（分批发货）→ ShipmentItem[]
//  - Shipment 是唯一的正式出运单实体，**不得**回退到 Order(type=SHIPPED)；
//  - 明细一律落 ShipmentItem（结构化），**不得**使用 JSON 出运明细 / 旧 OrderItem；
//  - 出运状态使用 ShipmentStatus，**不得**复用 SalesOrderStatus / 旧 Order.status；
//  - Schedule 无 ownerId 列 → 归属经 salesOrder.ownerId 施加 Scope（不新增列）。
//
// 【出货数量权威（P0）】
//   ShipmentItem.quantity  = 实际出货数量（source of truth）
//   SalesOrderItem.shippedQty = SUM(该订单行的全部 ShipmentItem.quantity)（派生汇总）
//   任何增删改之后一律**重算**，绝不使用 `shippedQty += quantity` 的累加写法。
//
// 已 Deferred（不在本轮）：
//  - shipmentNo 走 NumberSequence runtime（当前沿用「按日最大序号 +1」做法）
//  - 审批流转（全局 approval.controller 仍为 legacy，属独立 slice）
//  - QualityInspection 业务逻辑（仅详情只读 include）
//  - Payment / Profit（Shipment.freightAmountCny 为 ADR-20 唯一数据源，本轮不做汇率折算：
//    Shipment 无 exchangeRate 列，自动折算无法留痕 → 仅接受显式入参）
//  - SalesOrder.status 与 Shipment 的状态同步（无既定同步规则，本轮不同步）
// ============================================================

/** 列表统一 include：销售订单（归属经此）、客户、明细（含订单行） */
const SHIPMENT_INCLUDE: Prisma.ShipmentInclude = {
  salesOrder: { select: { id: true, orderNo: true, status: true, ownerId: true } },
  customer: { select: { id: true, customerNo: true, companyName: true } },
  items: {
    orderBy: { createdAt: 'asc' },
    include: { salesOrderItem: { select: { id: true, lineNo: true, productName: true } } },
  },
};

/** 详情额外只读 include 质检（宿主 exactly-one：productionOrderId XOR shipmentId） */
const SHIPMENT_DETAIL_INCLUDE: Prisma.ShipmentInclude = {
  ...SHIPMENT_INCLUDE,
  inspections: { select: { id: true, inspectionNo: true, type: true, result: true } },
};

/**
 * 允许出货的销售订单状态白名单（本轮确立的最小规则）：
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

/** 数量 / 金额入参：JSON number 或 string，一律经 Decimal 归一 */
const amountSchema = z.union([z.number(), z.string()]);

const itemSchema = z.object({
  salesOrderItemId: z.string().min(1, '订单明细不能为空'),
  productName: z.string().optional(),
  spec: z.string().optional().nullable(),
  quantity: amountSchema.optional(),
  packageCount: z.number().int().optional().nullable(),
  grossWeight: z.number().optional().nullable(),
  volume: z.number().optional().nullable(),
});

export type ShipmentItemInput = z.infer<typeof itemSchema>;

const createSchema = z.object({
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
  items: z.array(itemSchema).optional(),
});

const updateSchema = createSchema.partial().extend({
  id: z.string().min(1),
});

const listQuerySchema = z.object({
  salesOrderId: z.string().optional(),
  customerId: z.string().optional(),
  status: z.nativeEnum(ShipmentStatus).optional(),
  keyword: z.string().optional(),
  page: z.union([z.string(), z.number()]).optional(),
  pageSize: z.union([z.string(), z.number()]).optional(),
});

/** 业务规则违例（事务内抛出以回滚），由 handler 统一转为 400 */
class ShipmentRuleError extends Error {}

/**
 * 出货资格门禁违例（Round 3C-3-E-2-I）—— 由 handler 统一转为 **409**。
 *
 * 与 `ShipmentRuleError`（→400）**刻意分开**：R-3(c) 冻结 —— 既有 SalesOrder
 * SHIPPABLE 规则保持原 400 语义不变，仅本轮新增的
 * Quantity Eligibility 与 PRE_SHIPMENT QC Eligibility 使用 409。
 */
class ShipmentEligibilityError extends Error {}

interface ResolvedLine {
  salesOrderItemId: string;
  productName: string;
  spec: string | null;
  quantity: Prisma.Decimal;
  packageCount: number | null;
  grossWeight: number | null;
  volume: number | null;
}

type ParseLinesResult =
  | { ok: true; lines: ResolvedLine[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * 出运明细解析 + 快照（ADR-04）。
 *
 * 快照权威：显式传入 > SalesOrderItem 当前值。
 * 出运不修改 Product / CustomerProduct，也不回写 SalesOrderItem 快照字段。
 * ShipmentItem 无 productId 列，产品血缘经 salesOrderItemId 传递（Schema limitation）。
 */
async function parseLines(
  raw: ShipmentItemInput[] | undefined,
  salesOrderId: string,
): Promise<ParseLinesResult> {
  if (!raw || raw.length === 0) return { ok: true, lines: [] };

  const soItemIds = Array.from(new Set(raw.map((i) => i.salesOrderItemId)));
  const soItems = await prisma.salesOrderItem.findMany({
    where: { id: { in: soItemIds } },
    select: { id: true, orderId: true, productName: true, spec: true },
  });
  const soItemById = new Map(soItems.map((i) => [i.id, i]));

  const lines: ResolvedLine[] = [];
  for (const [index, item] of raw.entries()) {
    const soItem = soItemById.get(item.salesOrderItemId);
    if (!soItem) {
      return { ok: false, status: 404, message: `第 ${index + 1} 行明细：订单明细不存在` };
    }
    if (soItem.orderId !== salesOrderId) {
      return {
        ok: false,
        status: 400,
        message: `第 ${index + 1} 行明细：订单明细不属于该销售订单`,
      };
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

/**
 * 锁定受影响的 SalesOrderItem 行（并发硬化）。
 *
 * 目的：把「读聚合 → 判定 / 写回」纳入同一临界区，消除两类并发缺陷：
 *   1) over-shipment：两个并发请求各自读到 already = 0 → 双双通过上限校验；
 *   2) shippedQty 缓存陈旧：recalcShippedQty 的「groupBy 读 → UPDATE 写回」是两条语句，
 *      后提交方可能以更早快照的求和值整值覆写（经典 lost update）。
 *
 * 约束（不得放宽）：
 *   · 只锁 `SalesOrderItem` —— 它同时是「判定依据 quantity」与「派生缓存 shippedQty」的宿主；
 *   · 必须 `ORDER BY id ASC` —— 多行锁的确定性顺序，消除 AB/BA 循环等待；
 *   · 必须在**调用方的事务**内执行（锁随该事务提交/回滚释放）；
 *   · 入参先做 Set 去重 + 过滤空值；空数组直接返回（不得生成 `IN ()`）。
 */
async function lockSalesOrderItems(
  tx: Prisma.TransactionClient,
  salesOrderItemIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = Array.from(new Set(salesOrderItemIds.filter((v): v is string => Boolean(v)))).sort();
  if (ids.length === 0) return;

  await tx.$queryRaw`
    SELECT id
    FROM "SalesOrderItem"
    WHERE id IN (${Prisma.join(ids)})
    ORDER BY id ASC
    FOR UPDATE
  `;
}

/**
 * 出货数量上限校验：**本次请求量 <= 订单数量 - 已出货量**。
 *
 * 必须在「本单旧明细已删除」之后调用（同一事务内），此时 ShipmentItem 全集即为「其他出运单」的合计，
 * 因此天然避免重复累计。
 * 调用前必须已通过 lockSalesOrderItems 锁定相关订单行，否则判定与写入之间仍存在 TOCTOU 窗口。
 */
async function assertShippable(
  tx: Prisma.TransactionClient,
  lines: ResolvedLine[],
): Promise<void> {
  if (lines.length === 0) return;

  // 同一订单行被多行重复引用时，先在本请求内累计
  const requested = new Map<string, Prisma.Decimal>();
  for (const line of lines) {
    const current = requested.get(line.salesOrderItemId) ?? new Prisma.Decimal(0);
    requested.set(line.salesOrderItemId, current.plus(line.quantity));
  }

  const ids = Array.from(requested.keys());
  const [soItems, grouped] = await Promise.all([
    tx.salesOrderItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, quantity: true },
    }),
    tx.shipmentItem.groupBy({
      by: ['salesOrderItemId'],
      where: { salesOrderItemId: { in: ids } },
      _sum: { quantity: true },
    }),
  ]);

  const orderedById = new Map(soItems.map((i) => [i.id, i.quantity]));
  const shippedById = new Map(
    grouped.map((g) => [g.salesOrderItemId, toDecimal(g._sum.quantity) ?? new Prisma.Decimal(0)]),
  );

  for (const [id, req] of requested) {
    const ordered = orderedById.get(id);
    if (!ordered) throw new ShipmentRuleError('订单明细不存在');
    const already = shippedById.get(id) ?? new Prisma.Decimal(0);
    const available = ordered.minus(already);
    if (req.gt(available)) {
      throw new ShipmentRuleError(
        `出货数量超出可出货数量（订单数量 ${ordered.toFixed()}，已出货 ${already.toFixed()}，本次请求 ${req.toFixed()}）`,
      );
    }
  }
}

/**
 * 重算 shippedQty = SUM(该订单行全部 ShipmentItem.quantity)。
 * 必须以「重算」取代「累加」，否则 update / delete 后会重复累计。
 */
async function recalcShippedQty(
  tx: Prisma.TransactionClient,
  salesOrderItemIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(salesOrderItemIds)).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return;

  const grouped = await tx.shipmentItem.groupBy({
    by: ['salesOrderItemId'],
    where: { salesOrderItemId: { in: ids } },
    _sum: { quantity: true },
  });
  const sums = new Map(
    grouped.map((g) => [g.salesOrderItemId, toDecimal(g._sum.quantity) ?? new Prisma.Decimal(0)]),
  );

  for (const id of ids) {
    await tx.salesOrderItem.update({
      where: { id },
      data: { shippedQty: sums.get(id) ?? new Prisma.Decimal(0) },
    });
  }
}

/**
 * C-3 · 持久化出货数量门禁（Round 3C-3-E-2-I，仅 BOOKED → SHIPPED）
 *
 * 断言（逐订单行）：**本单最终量 + 其他出运单合计 ≤ SalesOrderItem.quantity**
 *
 * 为什么不能直接复用 `assertShippable`：
 *   `assertShippable` 的语义是「本次请求量 ≤ 订单量 − 其他出运单已出货量」，
 *   且其契约要求「在本单旧明细已删除之后调用」——只适用于**携带 items** 的路径。
 *   本函数改为「排除本单后取其他单合计，再加本单最终量」，
 *   对「items 缺席」的路径同样成立（C-3 要求无条件校验持久化状态）。
 *
 * 数量权威不变：`ShipmentItem.quantity` 仍是唯一权威，本函数**只读不写**，
 * 不产生第二套数量字段，也不触碰 `shippedQty` 的 SUM 重算语义。
 * 前置：调用方必须在同一事务内已持有这些 SalesOrderItem 的行锁（lockSalesOrderItems）。
 * 违例 → ShipmentEligibilityError（HTTP 409）。
 */
export async function assertShipmentQuantityEligible(
  tx: Prisma.TransactionClient,
  shipmentId: string,
  finalLines: Array<{ salesOrderItemId: string; quantity: Prisma.Decimal }>,
): Promise<void> {
  const ids = Array.from(
    new Set(finalLines.map((l) => l.salesOrderItemId).filter((v): v is string => Boolean(v))),
  ).sort();
  if (ids.length === 0) return;

  // 本单「最终」量（按订单行汇总；items 缺席时 finalLines = oldItems，即当前持久化明细）
  const ownById = new Map<string, Prisma.Decimal>();
  for (const line of finalLines) {
    ownById.set(
      line.salesOrderItemId,
      (ownById.get(line.salesOrderItemId) ?? new Prisma.Decimal(0)).plus(line.quantity),
    );
  }

  const [soItems, others] = await Promise.all([
    tx.salesOrderItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, quantity: true },
    }),
    tx.shipmentItem.groupBy({
      by: ['salesOrderItemId'],
      // 排除本单：本函数在「已删旧明细 / 尚未重建新明细」的任意中间态下都得到同一结论
      where: { salesOrderItemId: { in: ids }, shipmentId: { not: shipmentId } },
      _sum: { quantity: true },
    }),
  ]);

  const orderedById = new Map(soItems.map((i) => [i.id, i.quantity]));
  const otherById = new Map(
    others.map((g) => [g.salesOrderItemId, toDecimal(g._sum.quantity) ?? new Prisma.Decimal(0)]),
  );

  for (const id of ids) {
    const ordered = orderedById.get(id);
    if (!ordered) throw new ShipmentEligibilityError('订单明细不存在，无法确认出货数量');
    const own = ownById.get(id) ?? new Prisma.Decimal(0);
    const other = otherById.get(id) ?? new Prisma.Decimal(0);
    const total = own.plus(other);
    if (total.gt(ordered)) {
      throw new ShipmentEligibilityError(
        `出货数量超出订单数量，无法发运（订单数量 ${ordered.toFixed()}，本单 ${own.toFixed()}，其他出运单 ${other.toFixed()}）`,
      );
    }
  }
}

/**
 * C-2 · 出运前质检门禁（Round 3C-3-E-2-I，仅 BOOKED → SHIPPED）
 *
 * 「有效 QC」= 该 Shipment 下按 `createdAt DESC, id DESC` 排序的**最新一条**
 * `type = PRE_SHIPMENT` 质检单，且其**当前** result === PASSED。
 *
 * 明确禁止 `where: { result: PASSED } → findFirst()`（exists PASSED）语义：
 *   `QC#1 PASSED → QC#2 FAILED` 必须 REJECT；`CONDITIONAL ≠ PASSED`；无记录 → REJECT。
 *
 * 排序键选择依据：`createdAt` 非空且创建后不可变（主键）；`id` 为非空唯一值（确定性并列键）。
 * `inspectionDate` 可空、`updatedAt` 可被改写 → **均不得**用作排序键。
 *
 * 只读：不写 QualityInspection，不联动 ProductionStatus（D-FPO3-G = G1 保持）。
 * 违例 → ShipmentEligibilityError（HTTP 409）。
 */
export async function assertPreShipmentQcPassed(
  tx: Prisma.TransactionClient,
  shipmentId: string,
): Promise<void> {
  const latest = await tx.qualityInspection.findFirst({
    where: { shipmentId, type: InspectionType.PRE_SHIPMENT },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { inspectionNo: true, result: true },
  });

  if (!latest) {
    throw new ShipmentEligibilityError('出运前质检未完成：请先为该出运单创建 PRE_SHIPMENT 质检单');
  }
  if (latest.result !== InspectionResult.PASSED) {
    throw new ShipmentEligibilityError(
      `出运前质检未通过，无法发运（最新质检单「${latest.inspectionNo}」结果为 ${latest.result}）`,
    );
  }
}

/** 把明细行转为 ShipmentItem 写入数据 */
function toItemData(
  lines: ResolvedLine[],
): Prisma.ShipmentItemUncheckedCreateWithoutShipmentInput[] {
  return lines.map((line) => ({
    salesOrderItemId: line.salesOrderItemId,
    productName: line.productName,
    spec: line.spec,
    quantity: line.quantity,
    packageCount: line.packageCount,
    grossWeight: line.grossWeight,
    volume: line.volume,
  }));
}

/**
 * 当前用户数据范围（ALL / DEPT / SELF）。
 * Shipment 无 ownerId 列 → 归属经 salesOrder.ownerId（relation scope），不新增列、不并入公海。
 */
async function scopedWhere(req: AuthRequest, id: string): Promise<Record<string, unknown>> {
  return applyScope({ id }, await roleScope(req, { field: 'ownerId', relation: 'salesOrder' }));
}

function isForeignKeyError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ============================================================
// ShipmentStatus 状态机（Round 3C-3-E-1）
//
// 冻结决策：
//   · 正常主链   DRAFT → BOOKED → SHIPPED → ARRIVED → COMPLETED
//   · 异常终止支线 DRAFT / BOOKED / SHIPPED → CANCELLED（含客户自提场景）
//   · 严格终态   COMPLETED / CANCELLED
//
// 语义：
//   · **DEFAULT DENY** —— 未列出的跨状态转换一律拒绝（409），禁止「看起来合理」的推断；
//   · 同状态（X → X）为**幂等 no-op**，不视为状态转移（含 COMPLETED / CANCELLED 自身）；
//   · 终态以「出向集合为空」表达，不额外定义终态常量。
//
// 范围（本表仅用于 **update 的状态变更**）：
//   · create 初始状态策略**不变**（仍为 `body.status ?? ShipmentStatus.DRAFT`）；
//   · delete **不**加状态门槛；
//   · 不触碰数量语义（ShipmentItem.quantity 权威 / shippedQty 重算）、事务、Scope、OperationLog；
//   · 不引入 QC / Production / SalesOrder 任何 Gate，也不做状态同步。
//
// 说明：`SHIPPED → CANCELLED` 仅代表该出运**单据**被业务作废，
//       已发生的数量、操作日志与相关事实全部保留（不删除、不回滚 shippedQty）。
// ============================================================
const ALLOWED_SHIPMENT_TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  [ShipmentStatus.DRAFT]: [ShipmentStatus.BOOKED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.BOOKED]: [ShipmentStatus.SHIPPED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.SHIPPED]: [ShipmentStatus.ARRIVED, ShipmentStatus.CANCELLED],
  [ShipmentStatus.ARRIVED]: [ShipmentStatus.COMPLETED],
  // 终态：出向全部禁止（同状态 no-op 不受影响）
  [ShipmentStatus.COMPLETED]: [],
  [ShipmentStatus.CANCELLED]: [],
};

/** 状态转移 Gate 结果：ok=false 时由调用方统一按 409 处理 */
export type ShipmentStatusGateResult = { ok: true } | { ok: false; message: string };

/**
 * Shipment 状态转移 Gate（纯函数，无 IO —— 便于静态矩阵验证）。
 *
 * 判定顺序：
 *   1) 同状态 → 幂等 no-op（允许，含 COMPLETED / CANCELLED 自身重复提交）
 *   2) 跨状态 → 白名单（DEFAULT DENY，未列出即拒绝）
 *
 * 导出仅为可测试性；业务上只由本控制器 `updateShipment` 调用。
 */
export function checkShipmentStatusTransition(
  currentStatus: ShipmentStatus,
  requestedStatus: ShipmentStatus,
): ShipmentStatusGateResult {
  // 1) 同状态：幂等 no-op（终态「不可离开」与「同状态重复提交」并不冲突）
  if (currentStatus === requestedStatus) return { ok: true };

  // 2) 跨状态：白名单，未列出即拒绝
  if (!ALLOWED_SHIPMENT_TRANSITIONS[currentStatus].includes(requestedStatus)) {
    return {
      ok: false,
      message: `出运单状态不能从 ${currentStatus} 转换为 ${requestedStatus}`,
    };
  }

  return { ok: true };
}

/** 出运单基础字段组装（create / update 共用） */
type ShipmentBaseInput = Partial<z.infer<typeof createSchema>>;

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

// ============ 列表 ============
export const listShipments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = listQuerySchema.parse(req.query);
    let where: Record<string, unknown> = {};
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

    where = applyScope(where, await roleScope(req, { field: 'ownerId', relation: 'salesOrder' }));

    const pageNum = Math.max(1, Number(query.page) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
    const [list, total] = await Promise.all([
      prisma.shipment.findMany({
        where,
        include: SHIPMENT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.shipment.count({ where }),
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
export const getShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.shipment.findFirst({
      where: await scopedWhere(req, req.params.id),
      include: SHIPMENT_DETAIL_INCLUDE,
    });
    if (!item) {
      fail(res, 404, '出运单不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（事务：上限校验 → 建单 → 重算 shippedQty） ============
export const createShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = createSchema.parse(req.body);

    const salesOrder = await prisma.salesOrder.findUnique({
      where: { id: body.salesOrderId },
      select: { id: true, orderNo: true, status: true, customerId: true },
    });
    if (!salesOrder) {
      fail(res, 400, '销售订单不存在');
      return;
    }
    if (!SHIPPABLE_STATUSES.includes(salesOrder.status)) {
      fail(res, 400, `销售订单当前状态（${salesOrder.status}）不允许出货`);
      return;
    }

    const customerId = body.customerId ?? salesOrder.customerId;
    if (!customerId) {
      fail(res, 400, '客户不能为空');
      return;
    }
    if (customerId !== salesOrder.customerId) {
      fail(res, 400, '客户与销售订单所属客户不一致');
      return;
    }
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });
    if (!customer) {
      fail(res, 400, '客户不存在');
      return;
    }

    const parsed = await parseLines(body.items, salesOrder.id);
    if (!parsed.ok) {
      fail(res, parsed.status, parsed.message);
      return;
    }

    const data = baseData(body);

    const item = await prisma.$transaction(async (tx) => {
      // 并发硬化：先锁定受影响的订单行（id ASC），使上限校验与 recalc 处于同一临界区
      await lockSalesOrderItems(tx, parsed.lines.map((l) => l.salesOrderItemId));

      // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
      const shipmentNo = await getNextNumber(tx, 'SHP');

      await assertShippable(tx, parsed.lines);

      const createdShipment = await tx.shipment.create({
        data: {
          shipmentNo,
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
          createdBy: req.userId ?? null,
          ...(parsed.lines.length > 0 ? { items: { create: toItemData(parsed.lines) } } : {}),
        },
        include: SHIPMENT_INCLUDE,
      });

      await recalcShippedQty(
        tx,
        parsed.lines.map((l) => l.salesOrderItemId),
      );
      return createdShipment;
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'CREATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.SHIPMENT,
      businessId: item.id,
      businessNo: item.shipmentNo,
      summary: `${req.username ?? ''} 创建了出运单「${item.shipmentNo}」（来源订单 ${salesOrder.orderNo}）`,
      ip: req.ip,
      customerId,
    });

    created(res, item);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ShipmentRuleError) {
      fail(res, 400, e.message);
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '出运单号冲突，请重试');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（事务：先删旧明细 → 上限校验 → 重建 → 重算 shippedQty） ============
export const updateShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = updateSchema.parse({ id: req.params.id, ...req.body });

    const existing = await prisma.shipment.findFirst({
      where: await scopedWhere(req, id),
      // status：状态转移 Gate 所需（scope 通过后才读取）
      select: { id: true, shipmentNo: true, salesOrderId: true, customerId: true, status: true },
    });
    if (!existing) {
      fail(res, 404, '出运单不存在');
      return;
    }
    if (rest.salesOrderId !== undefined && rest.salesOrderId !== existing.salesOrderId) {
      fail(res, 400, '不支持修改所属销售订单，请重建出运单');
      return;
    }
    if (rest.customerId !== undefined && rest.customerId !== existing.customerId) {
      fail(res, 400, '不支持修改所属客户，请重建出运单');
      return;
    }

    // ---- 状态转移 Gate（Round 3C-3-E-1：scope 已通过，此处仅判定「该转换是否合法」）----
    // 必须在任何写入之前完成（早于 $transaction 与 data.status），同状态为幂等 no-op。
    if (rest.status !== undefined) {
      const gate = checkShipmentStatusTransition(existing.status, rest.status);
      if (!gate.ok) {
        fail(res, 409, gate.message);
        return;
      }
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
      const salesOrder = await prisma.salesOrder.findUnique({
        where: { id: existing.salesOrderId },
        select: { id: true, status: true },
      });
      if (!salesOrder) {
        fail(res, 400, '销售订单不存在');
        return;
      }
      // 沿用既有 SalesOrder SHIPPABLE 规则：**保持原有 400**（R-3(c) 冻结，不改既有语义）
      if (!SHIPPABLE_STATUSES.includes(salesOrder.status)) {
        fail(res, 400, `销售订单当前状态（${salesOrder.status}）不允许出货`);
        return;
      }
    }

    let parsedLines: ResolvedLine[] | null = null;
    if (rest.items !== undefined) {
      const parsed = await parseLines(rest.items, existing.salesOrderId);
      if (!parsed.ok) {
        fail(res, parsed.status, parsed.message);
        return;
      }
      parsedLines = parsed.lines;
    }

    const data = baseData(rest);

    const item = await prisma.$transaction(async (tx) => {
      const oldItems = await tx.shipmentItem.findMany({
        where: { shipmentId: existing.id },
        // quantity：C-3 门禁需要「本单最终量」；items 缺席时 oldItems 即最终持久化明细
        select: { salesOrderItemId: true, quantity: true },
      });
      const affected = new Set(oldItems.map((i) => i.salesOrderItemId));

      // 并发硬化：必须在 deleteMany 之前锁定「旧明细 + 新明细」的全部订单行（id ASC）。
      // 若先删除再加锁，其他事务可能在临界区外观察到「旧明细已删、新明细未建」的中间状态。
      await lockSalesOrderItems(tx, [
        ...oldItems.map((i) => i.salesOrderItemId),
        ...(parsedLines ?? []).map((l) => l.salesOrderItemId),
      ]);

      if (parsedLines) {
        // 先删旧明细，使 assertShippable 的聚合基数 = 其他出运单 → 避免重复累计
        await tx.shipmentItem.deleteMany({ where: { shipmentId: existing.id } });
        await assertShippable(tx, parsedLines);
      }

      // ---- Shipment Eligibility Gate（Round 3C-3-E-2-I，仅 BOOKED → SHIPPED）----
      // 顺序冻结：C-3 数量 → C-2 出运前质检 → 状态写入。任一失败即 throw → 事务回滚，
      // 不会出现「Shipment.status 已 SHIPPED 但 Gate 未过」。
      // 落点：此处已取得 SalesOrderItem 行锁（上方 lockSalesOrderItems），
      //       且 tx.shipment.update 的嵌套 items.create 尚未执行
      //       ⇒「最终持久化状态」以 (parsedLines ?? oldItems) 表达。
      // 与 items 是否携带**无关**（C-3 要求无条件校验持久化状态）。
      if (isBookedToShipped) {
        await assertShipmentQuantityEligible(tx, existing.id, parsedLines ?? oldItems);
        await assertPreShipmentQcPassed(tx, existing.id);
      }

      const updatedShipment = await tx.shipment.update({
        where: { id: existing.id },
        data: {
          ...(data.status !== undefined ? { status: data.status } : {}),
          ...(rest.shipmentDate !== undefined ? { shipmentDate: data.shipmentDate ?? null } : {}),
          ...(rest.etd !== undefined ? { etd: data.etd ?? null } : {}),
          ...(rest.eta !== undefined ? { eta: data.eta ?? null } : {}),
          ...(rest.atd !== undefined ? { atd: data.atd ?? null } : {}),
          ...(rest.ata !== undefined ? { ata: data.ata ?? null } : {}),
          ...(rest.incoterm !== undefined ? { incoterm: data.incoterm ?? null } : {}),
          ...(rest.portOfLoading !== undefined ? { portOfLoading: data.portOfLoading ?? null } : {}),
          ...(rest.portOfDischarge !== undefined
            ? { portOfDischarge: data.portOfDischarge ?? null }
            : {}),
          ...(rest.carrier !== undefined ? { carrier: data.carrier ?? null } : {}),
          ...(rest.vessel !== undefined ? { vessel: data.vessel ?? null } : {}),
          ...(rest.billOfLadingNo !== undefined
            ? { billOfLadingNo: data.billOfLadingNo ?? null }
            : {}),
          ...(rest.trackingNo !== undefined ? { trackingNo: data.trackingNo ?? null } : {}),
          ...(rest.shippingMethod !== undefined
            ? { shippingMethod: data.shippingMethod ?? null }
            : {}),
          ...(rest.packageCount !== undefined ? { packageCount: data.packageCount ?? null } : {}),
          ...(rest.grossWeight !== undefined ? { grossWeight: data.grossWeight ?? null } : {}),
          ...(rest.netWeight !== undefined ? { netWeight: data.netWeight ?? null } : {}),
          ...(rest.volume !== undefined ? { volume: data.volume ?? null } : {}),
          ...(rest.freightAmount !== undefined ? { freightAmount: data.freightAmount } : {}),
          ...(rest.freightCurrency !== undefined
            ? { freightCurrency: data.freightCurrency ?? null }
            : {}),
          ...(rest.freightAmountCny !== undefined ? { freightAmountCny: data.freightAmountCny } : {}),
          ...(rest.customsDeclarationNo !== undefined
            ? { customsDeclarationNo: data.customsDeclarationNo ?? null }
            : {}),
          ...(rest.notes !== undefined ? { notes: data.notes ?? null } : {}),
          ...(parsedLines
            ? { items: { create: toItemData(parsedLines) } }
            : {}),
          updatedBy: req.userId ?? null,
        },
        include: SHIPMENT_INCLUDE,
      });

      if (parsedLines) {
        for (const line of parsedLines) affected.add(line.salesOrderItemId);
      }
      await recalcShippedQty(tx, Array.from(affected));
      return updatedShipment;
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'UPDATE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.SHIPMENT,
      businessId: item.id,
      businessNo: item.shipmentNo,
      summary: `${req.username ?? ''} 更新了出运单「${item.shipmentNo}」`,
      ip: req.ip,
      customerId: item.customerId,
    });

    success(res, item, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (e instanceof ShipmentEligibilityError) {
      // 新增 Eligibility Gate（C-3 数量 / C-2 出运前质检）→ 409（R-3(c)）
      fail(res, 409, e.message);
      return;
    }
    if (e instanceof ShipmentRuleError) {
      fail(res, 400, e.message);
      return;
    }
    if (isForeignKeyError(e)) {
      fail(res, 409, '出运单存在下游单据引用，无法修改');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除（事务：先取受影响订单行 → 删单（明细 Cascade）→ 重算 shippedQty） ============
export const removeShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await prisma.shipment.findFirst({
      where: await scopedWhere(req, req.params.id),
      select: { id: true, shipmentNo: true, customerId: true },
    });
    if (!existing) {
      fail(res, 404, '出运单不存在');
      return;
    }

    await prisma.$transaction(async (tx) => {
      const oldItems = await tx.shipmentItem.findMany({
        where: { shipmentId: existing.id },
        select: { salesOrderItemId: true },
      });
      // 并发硬化：delete 路径不经过 assertShippable，必须显式锁定受影响订单行（id ASC），
      // 以与并发 create/update 的上限校验与 recalc 串行化。
      await lockSalesOrderItems(tx, oldItems.map((i) => i.salesOrderItemId));

      // Shipment → ShipmentItem 为 Cascade（遵守 schema，不自行改变 relation）
      await tx.shipment.delete({ where: { id: existing.id } });
      await recalcShippedQty(
        tx,
        oldItems.map((i) => i.salesOrderItemId),
      );
    });

    void activityLogger.log({
      userId: req.userId ?? '',
      username: req.username ?? '',
      realName: req.realName,
      action: 'DELETE',
      module: 'fulfillment',
      businessType: BUSINESS_TYPE.SHIPMENT,
      businessId: existing.id,
      businessNo: existing.shipmentNo,
      summary: `${req.username ?? ''} 删除了出运单「${existing.shipmentNo}」`,
      ip: req.ip,
      customerId: existing.customerId,
    });

    success(res, null, '删除成功');
  } catch (e) {
    if (isForeignKeyError(e)) {
      fail(res, 409, '该出运单存在质检等下游单据，无法删除');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
