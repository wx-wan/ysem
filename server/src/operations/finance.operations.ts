import { Prisma, ProfitStatus } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import {
  paymentRepository,
  profitRepository,
  runInTransaction,
  salesOrderRepository,
  shipmentRepository,
  type TxClient,
} from '../repositories';
import { DECIMAL_PRECISION, toDecimal } from '../utils/currency';

/**
 * Finance Operation Layer —— Round R-5 · Phase 4 · D2 财务域（payment + profit）
 *
 * 职责：**跨域回写**与**事务编排**
 *   · `payment` → `SalesOrder.paidAmountCny` 重算（跨域：财务 → 履约）
 *   · `profit`  → `Shipment.freightAmountCny` 归集（跨域：财务 → 履约，ADR-20 服务端权威）
 *   · 编号分配与业务写入同事务；行级锁纳入同一临界区
 *
 * 不负责业务政策（exactly-one 宿主、客户一致性、收入口径、利润/利润率公式）——
 * 那些在 `services/payment.service.ts` / `services/profit.service.ts`（Business）。
 *
 * 【事务归属（Master Plan §12）】本文件是财务域 `$transaction` 的唯一归属地。
 */

const ZERO = new Prisma.Decimal(0);

// ============================================================
// SalesOrder.paidAmountCny 权威维护（P0）
// ============================================================

/**
 * 锁定受影响的 SalesOrder 行（并发硬化）。
 * 锁 SQL 属 Data 层（`salesOrderRepository.lockRowsForUpdate`），本层只负责编排时机。
 */
function lockSalesOrders(tx: TxClient, ids: Array<string | null | undefined>): Promise<void> {
  return salesOrderRepository.lockRowsForUpdate(ids, tx);
}

/**
 * 重算 `SalesOrder.paidAmountCny` = SUM(Payment.amountCny WHERE IN + CONFIRMED)。
 *
 * 必须以**重算 + 整值覆写**取代 `+=` 累加，否则 status / amount / owner 变更后会留下错误累计。
 * NULL 语义：SUM 忽略 NULL；无有效金额 → 写 0（绝不写 NULL）。
 * 调用前必须已通过 `lockSalesOrders` 锁定相关宿主，否则聚合与写回之间仍存在 lost update 窗口。
 */
async function recalcPaidAmountCny(tx: TxClient, salesOrderId: string | null | undefined): Promise<void> {
  if (!salesOrderId) return;
  const sum = await paymentRepository.sumConfirmedInCny(salesOrderId, tx);
  await salesOrderRepository.update(
    {
      where: { id: salesOrderId },
      data: { paidAmountCny: toDecimal(sum ?? null) ?? ZERO },
    },
    tx,
  );
}

/** 对去重后的多个 SalesOrder 依次重算（owner 迁移不留残留） */
async function recalcAll(tx: TxClient, salesOrderIds: Array<string | null | undefined>): Promise<void> {
  const ids = Array.from(new Set(salesOrderIds.filter((v): v is string => Boolean(v))));
  for (const id of ids) await recalcPaidAmountCny(tx, id);
}

// ============================================================
// Payment
// ============================================================

/** 新建收付款单：锁宿主 → 取号 → 落库 → 重算宿主派生字段（同一事务） */
export function createPaymentAggregate<I extends Prisma.PaymentInclude>(
  data: Omit<Prisma.PaymentUncheckedCreateInput, 'paymentNo'>,
  include: I,
): Promise<Prisma.PaymentGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    // 并发硬化：先锁定受影响宿主（仅 IN 方向有 SalesOrder 宿主；OUT 传 null 自动跳过）
    await lockSalesOrders(tx, [data.salesOrderId]);

    const paymentNo = await getNextNumber(tx, 'PAY');
    const created = (await paymentRepository.create({ data: { ...data, paymentNo }, include }, tx)) as unknown as
      Prisma.PaymentGetPayload<{ include: I }>;

    await recalcAll(tx, [created.salesOrderId]);
    return created;
  });
}

/**
 * 更新收付款单：锁「旧宿主 + 新宿主」两行 → 落库 → 两宿主去重重算（同一事务）。
 * 锁必须在 update **之前**取，且排序（id ASC，由 Data 层保证）以消除 AB/BA 死锁。
 */
export function updatePaymentAggregate<I extends Prisma.PaymentInclude>(input: {
  id: string;
  data: Prisma.PaymentUncheckedUpdateInput;
  include: I;
  previousSalesOrderId: string | null;
  nextSalesOrderId: string | null;
}): Promise<Prisma.PaymentGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    await lockSalesOrders(tx, [input.previousSalesOrderId, input.nextSalesOrderId]);
    const updated = (await paymentRepository.update(
      { where: { id: input.id }, data: input.data, include: input.include },
      tx,
    )) as unknown as Prisma.PaymentGetPayload<{ include: I }>;

    await recalcAll(tx, [input.previousSalesOrderId, updated.salesOrderId]);
    return updated;
  });
}

/** 删除收付款单：锁宿主 → 删单 → 重算（OUT 宿主为 null → 自动跳过） */
export function removePaymentAggregate(input: {
  id: string;
  salesOrderId: string | null;
}): Promise<void> {
  return runInTransaction(async (tx) => {
    await lockSalesOrders(tx, [input.salesOrderId]);
    await paymentRepository.delete(input.id, tx);
    await recalcAll(tx, [input.salesOrderId]);
  });
}

// ============================================================
// Profit（运费归集 + 取号 + 落库）
// ============================================================

/** 运费归集结果（ADR-20） */
export interface FreightAggregate {
  value: Prisma.Decimal;
  /** 有有效运费的出货单数 */
  contributingCount: number;
  /** 该订单下出货单总数 */
  totalCount: number;
}

/**
 * 运费归集（ADR-20）：Σ Shipment.freightAmountCny（WHERE salesOrderId = X）。
 * NULL 的 freightAmountCny 不计入 SUM；无有效运费 → 0。**服务端权威**，不接受客户端传入。
 */
async function aggregateFreight(tx: TxClient, salesOrderId: string): Promise<FreightAggregate> {
  const shipments = await shipmentRepository.findFreightBySalesOrderId(salesOrderId, tx);
  let value = ZERO;
  let contributingCount = 0;
  for (const shipment of shipments) {
    const amount = toDecimal(shipment.freightAmountCny);
    if (!amount) continue;
    value = value.plus(amount);
    contributingCount += 1;
  }
  return {
    value: value.toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP),
    contributingCount,
    totalCount: shipments.length,
  };
}

/** 由 Business 层提供的纯计算字段（利润 / 利润率 / costSnapshot 等业务口径不进入本层） */
export type ProfitFields = Omit<
  Prisma.ProfitUncheckedCreateInput,
  'profitNo' | 'salesOrderId' | 'status' | 'remark' | 'createdBy'
>;

/** 新建利润单：取号 → 归集运费 → 落库（同一事务） */
export function createProfitAggregate<I extends Prisma.ProfitInclude>(
  meta: {
    salesOrderId: string;
    status: ProfitStatus;
    remark: string | null;
    createdBy: string | null;
  },
  buildFields: (freight: FreightAggregate) => ProfitFields,
  include: I,
): Promise<Prisma.ProfitGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const profitNo = await getNextNumber(tx, 'PRF');
    // 运费每次都由 Shipment 重新聚合（server authoritative）
    const freight = await aggregateFreight(tx, meta.salesOrderId);
    const fields = buildFields(freight);

    return profitRepository.create(
      {
        data: {
          ...fields,
          profitNo,
          salesOrderId: meta.salesOrderId,
          status: meta.status,
          remark: meta.remark,
          createdBy: meta.createdBy,
        },
        include,
      },
      tx,
    ) as unknown as Promise<Prisma.ProfitGetPayload<{ include: I }>>;
  });
}

/** 更新利润单：全量重算（含运费重新聚合），同一事务 */
export function updateProfitAggregate<I extends Prisma.ProfitInclude>(
  id: string,
  salesOrderId: string,
  buildFields: (freight: FreightAggregate) => ProfitFields,
  extra: { status?: ProfitStatus; remark?: string | null; updatedBy: string | null },
  include: I,
): Promise<Prisma.ProfitGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const freight = await aggregateFreight(tx, salesOrderId);
    const fields = buildFields(freight);

    return profitRepository.update(
      {
        where: { id },
        data: {
          ...fields,
          ...(extra.status !== undefined ? { status: extra.status } : {}),
          ...(extra.remark !== undefined ? { remark: extra.remark } : {}),
          updatedBy: extra.updatedBy,
        },
        include,
      },
      tx,
    ) as unknown as Promise<Prisma.ProfitGetPayload<{ include: I }>>;
  });
}
