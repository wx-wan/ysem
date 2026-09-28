import type { InspectionResult, Prisma } from '@prisma/client';
import { ShipmentStatus } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import {
  qualityInspectionRepository,
  runInTransaction,
  salesOrderRepository,
  shipmentRepository,
  type DbClient,
} from '../repositories';
import { toDecimal } from '../utils/currency';
import { InspectionType } from '@prisma/client';

/**
 * Shipment Operation Layer —— Round R-5 · Phase 4 · D1-c 出运域
 *
 * 职责：**事务编排** + 「出货数量临界区」+「`shippedQty` 派生缓存重算」+
 *       「跨域只读（SalesOrder / QualityInspection）与行锁」。
 *
 * 不负责业务口径（出货上限、C-3 数量门禁、C-2 出运前质检门禁的判定规则）——
 * 那些在 `services/shipment.service.ts`（Business），以**纯回调**注入事务：
 * 本层在事务内把聚合数据读好，交给纯函数判定，Business **永不接触 `tx`**（遵守 §12）。
 *
 * 【出货数量权威（P0）】
 *   ShipmentItem.quantity     = 实际出货数量（source of truth）
 *   SalesOrderItem.shippedQty = SUM(该订单行的全部有效 ShipmentItem.quantity)（**派生缓存**）
 *   任何增删改之后一律**重算**，绝不使用 `shippedQty += quantity` 的累加写法。
 *
 * 【事务归属（Master Plan §12）】本文件是出运域 `$transaction` 的唯一归属地。
 */

export interface ShipmentLineRow {
  salesOrderItemId: string;
  productName: string;
  spec: string | null;
  quantity: Prisma.Decimal;
  packageCount: number | null;
  grossWeight: number | null;
  volume: number | null;
}

/** `assertShippable` 的判定上下文（聚合已由本层在事务内读出） */
export interface ShippableContext {
  /** 订单行订购数量 */
  orderedById: Map<string, Prisma.Decimal>;
  /** 其他出运单（CANCELLED 除外）已出货量合计 */
  shippedById: Map<string, Prisma.Decimal>;
}
export type AssertShippable = (ctx: ShippableContext) => void;

/** C-3 持久化数量门禁判定上下文 */
export interface QuantityEligibilityContext {
  orderedById: Map<string, Prisma.Decimal>;
  /** 本单最终量（items 缺席时即当前持久化明细） */
  ownById: Map<string, Prisma.Decimal>;
  /** 其他出运单合计（排除本单 + 排除 CANCELLED） */
  otherById: Map<string, Prisma.Decimal>;
}
export type AssertQuantityEligible = (ctx: QuantityEligibilityContext) => void;

/** C-2 出运前质检快照（最新一条 PRE_SHIPMENT；无记录为 null） */
export interface PreShipmentQcSnapshot {
  inspectionNo: string;
  result: InspectionResult;
}
export type AssertPreShipmentQcPassed = (latest: PreShipmentQcSnapshot | null) => void;

/** 把聚合 groupBy 结果转成 Map（Decimal 归一；缺失即 0） */
function sumMap(
  grouped: Array<{ salesOrderItemId: string | null; _sum: { quantity: Prisma.Decimal | null } }>,
): Map<string, Prisma.Decimal> {
  return new Map(
    grouped
      .filter((g): g is { salesOrderItemId: string; _sum: { quantity: Prisma.Decimal | null } } =>
        Boolean(g.salesOrderItemId),)
      .map((g) => [g.salesOrderItemId, toDecimal(g._sum.quantity) ?? toDecimal(0)!]),
  );
}

/**
 * 重算 `shippedQty = SUM(该订单行全部有效 ShipmentItem.quantity)`。
 * 必须以「重算」取代「累加」，否则 update / delete 后会重复累计。
 */
async function recalcShippedQty(
  tx: DbClient,
  salesOrderItemIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(salesOrderItemIds)).filter((v): v is string => Boolean(v));
  if (ids.length === 0) return;
  const grouped = await salesOrderRepository.groupShippedQtyByItemIds(ids, {}, tx);
  const sums = sumMap(grouped);
  for (const id of ids) {
    await salesOrderRepository.updateItemShippedQty(id, sums.get(id) ?? toDecimal(0)!, tx);
  }
}

// ============================================================
// 新建（事务：上限校验 → 建单 → 重算 shippedQty）
// ============================================================

export function createShipmentAggregate<I extends Prisma.ShipmentInclude>(input: {
  lines: ShipmentLineRow[];
  base: Omit<Prisma.ShipmentUncheckedCreateInput, 'shipmentNo' | 'items'>;
  assertShippable: AssertShippable;
  include: I;
}): Promise<Prisma.ShipmentGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    // 并发硬化：先锁定受影响的订单行（id ASC），使上限校验与 recalc 处于同一临界区
    await salesOrderRepository.lockItemsForUpdate(
      input.lines.map((l) => l.salesOrderItemId),
      tx,
    );

    // 编号分配与业务写入同事务：业务失败 → 计数一并回滚，不产生编号空洞
    const shipmentNo = await getNextNumber(tx, 'SHP');

    await assertShippableInTx(tx, input.lines, input.assertShippable);

    const created = await shipmentRepository.create(
      {
        data: {
          ...input.base,
          shipmentNo,
          ...(input.lines.length > 0 ? { items: { create: itemRows(input.lines) } } : {}),
        },
        include: input.include,
      },
      tx,
    );

    await recalcShippedQty(tx, input.lines.map((l) => l.salesOrderItemId));
    return created;
  });
}

/** 读取聚合 → 交纯函数判定（业务规则在 Business；此处只负责读数与时机） */
async function assertShippableInTx(
  tx: DbClient,
  lines: ShipmentLineRow[],
  assertShippable: AssertShippable,
): Promise<void> {
  if (lines.length === 0) return;
  const ids = Array.from(new Set(lines.map((l) => l.salesOrderItemId)));
  const [soItems, grouped] = await Promise.all([
    salesOrderRepository.findItemQuantitiesByIds(ids, tx),
    salesOrderRepository.groupShippedQtyByItemIds(ids, {}, tx),
  ]);
  assertShippable({
    orderedById: new Map(soItems.map((i) => [i.id, i.quantity])),
    shippedById: sumMap(grouped),
  });
}

// ============================================================
// 更新（事务：先删旧明细 → 上限校验 → Eligibility Gate → 重建 → 重算）
// ============================================================

export function updateShipmentAggregate<I extends Prisma.ShipmentInclude>(input: {
  id: string;
  /** 新明细；`null` 表示本次不改明细 */
  lines: ShipmentLineRow[] | null;
  data: Prisma.ShipmentUncheckedUpdateInput;
  assertShippable: AssertShippable;
  /** 仅 BOOKED → SHIPPED 时调用 */
  eligibility: { assertQuantityEligible: AssertQuantityEligible; assertQcPassed: AssertPreShipmentQcPassed } | null;
  include: I;
}): Promise<Prisma.ShipmentGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const oldItems = await shipmentRepository.findItemsByShipmentId(input.id, tx);
    const affected = new Set(oldItems.map((i) => i.salesOrderItemId));

    // 并发硬化：必须在 deleteMany 之前锁定「旧明细 + 新明细」的全部订单行（id ASC）。
    // 若先删除再加锁，其他事务可能在临界区外观察到「旧明细已删、新明细未建」的中间状态。
    await salesOrderRepository.lockItemsForUpdate(
      [...oldItems.map((i) => i.salesOrderItemId), ...(input.lines ?? []).map((l) => l.salesOrderItemId)],
      tx,
    );

    if (input.lines) {
      // 先删旧明细，使 assertShippable 的聚合基数 = 其他出运单 → 避免重复累计
      await shipmentRepository.deleteItemsByShipmentId(input.id, tx);
      await assertShippableInTx(tx, input.lines, input.assertShippable);
    }

    // ---- Shipment Eligibility Gate（仅 BOOKED → SHIPPED）----
    // 顺序冻结：C-3 数量 → C-2 出运前质检 → 状态写入。任一失败即 throw → 事务回滚，
    // 不会出现「Shipment.status 已 SHIPPED 但 Gate 未过」。
    // 落点：此处已取得 SalesOrderItem 行锁，且 tx.shipment.update 的嵌套 items.create 尚未执行
    //       ⇒「最终持久化状态」以 (lines ?? oldItems) 表达。
    // 与 items 是否携带**无关**（C-3 要求无条件校验持久化状态）。
    if (input.eligibility) {
      await assertQuantityEligibleInTx(tx, input.id, input.lines ?? oldItems, input.eligibility.assertQuantityEligible);
      const latest = await qualityInspectionRepository.findLatestPreShipment(
        input.id,
        InspectionType.PRE_SHIPMENT,
        tx,
      );
      input.eligibility.assertQcPassed(latest);
    }

    const updated = await shipmentRepository.update(
      {
        where: { id: input.id },
        data: {
          ...input.data,
          ...(input.lines ? { items: { create: itemRows(input.lines) } } : {}),
        },
        include: input.include,
      },
      tx,
    );

    if (input.lines) for (const line of input.lines) affected.add(line.salesOrderItemId);
    await recalcShippedQty(tx, Array.from(affected));
    return updated;
  });
}

/** C-3：读「订购量 / 本单最终量 / 其他单合计」→ 交纯函数判定 */
async function assertQuantityEligibleInTx(
  tx: DbClient,
  shipmentId: string,
  finalLines: Array<{ salesOrderItemId: string; quantity: Prisma.Decimal }>,
  assertQuantityEligible: AssertQuantityEligible,
): Promise<void> {
  const ids = Array.from(
    new Set(finalLines.map((l) => l.salesOrderItemId).filter((v): v is string => Boolean(v))),
  ).sort();
  if (ids.length === 0) return;

  const ownById = new Map<string, Prisma.Decimal>();
  for (const line of finalLines) {
    ownById.set(
      line.salesOrderItemId,
      (ownById.get(line.salesOrderItemId) ?? toDecimal(0)!).plus(line.quantity),
    );
  }

  const [soItems, others] = await Promise.all([
    salesOrderRepository.findItemQuantitiesByIds(ids, tx),
    salesOrderRepository.groupShippedQtyByItemIds(ids, { excludeShipmentId: shipmentId }, tx),
  ]);

  assertQuantityEligible({
    orderedById: new Map(soItems.map((i) => [i.id, i.quantity])),
    ownById,
    otherById: sumMap(others),
  });
}

function itemRows(
  lines: ShipmentLineRow[],
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

export { ShipmentStatus };
