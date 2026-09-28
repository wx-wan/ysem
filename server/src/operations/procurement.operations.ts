import type { PurchaseItemStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import { DomainNotFoundError, DomainValidationError } from '../lib/errors';
import {
  productionOrderRepository,
  productRepository,
  purchaseOrderRepository,
  runInTransaction,
  supplierRepository,
  type TxClient,
} from '../repositories';

/**
 * Procurement Operation Layer —— Round R-5 · Phase 4 · D1-a 采购域
 *
 * 职责：**事务编排** + 「成本归集链」引用读取与**行锁**（跨域：采购 ← 生产 ← 销售）。
 *
 * 不负责业务口径（明细合法性、金额/币种规则、引用存在性判定、汇总重算条件）——
 * 那些在 `services/purchaseOrder.service.ts`（Business），通过**纯回调**注入事务。
 *
 * 【设计说明（明示）】业务规则以 `plan(已加载数据)` / `buildData(plan结果)` 纯函数形式
 * **回调注入**事务：Business 永不接触 `tx`（遵守 §12「Business 不直接持有 Prisma transaction」），
 * 而事务、行锁、取号、落库全部留在本层。
 *
 * 【事务归属（Master Plan §12）】本文件是采购域 `$transaction` 的唯一归属地。
 */

// ============================================================
// Supplier
// ============================================================

/** 新增供应商：编号分配与业务写入同事务（业务失败 → 计数一并回滚，不产生编号空洞） */
export function createSupplierAggregate(data: {
  name: string;
  contact: string | null;
  phone: string | null;
  address: string | null;
  remark: string | null;
  createdBy: string | null;
}) {
  return runInTransaction(async (tx) => {
    const supplierNo = await getNextNumber(tx, 'SUP');
    return supplierRepository.create({ ...data, supplierNo }, tx);
  });
}

// ============================================================
// PurchaseOrder —— 成本归集链引用上下文
// ============================================================

export interface ProductionItemRef {
  id: string;
  productionOrderId: string;
}

export interface PreservedItemState {
  arrivedQty: Prisma.Decimal;
  status: PurchaseItemStatus;
}

/** 由本层在事务内加载、交给 Business 纯函数判定的数据上下文 */
export interface PurchaseItemsContext {
  /** 请求中出现的 productId（去重） */
  requestedProductIds: string[];
  /** 在上述集合中，对调用者**可见**的 productId（不可见与不存在同结果） */
  visibleProductIds: string[];
  /** 请求中出现的 productionOrderItemId 对应的生产明细（含所属工单） */
  productionItems: ProductionItemRef[];
  /** 更新场景：既有明细按 lineNo 的行级状态（保留 arrivedQty / status） */
  preserveByLine?: Map<number, PreservedItemState>;
}

export type ItemsPlanResult =
  | {
      ok: true;
      data: Prisma.PurchaseOrderItemUncheckedCreateWithoutPurchaseOrderInput[];
      total: Prisma.Decimal;
    }
  | { ok: false; status: 400 | 404; message: string };

export type BuildItemsPlan = (ctx: PurchaseItemsContext) => ItemsPlanResult;

/** 业务判定失败 → 对应域错误（文案与状态码由 Business 给出，逐字透传） */
function toDomainError(result: { status: number; message: string }): Error {
  return result.status === 404
    ? new DomainNotFoundError(result.message)
    : new DomainValidationError(result.message);
}

/** 采购明细引用的生产明细 id（去重；用于加锁与加载） */
function productionItemIdsOf(
  items: ReadonlyArray<{ productionOrderItemId?: string | null }> | undefined,
): string[] {
  return Array.from(
    new Set((items ?? []).map((i) => i.productionOrderItemId).filter((v): v is string => Boolean(v))),
  );
}

function productIdsOf(items: ReadonlyArray<{ productId?: string | null }> | undefined): string[] {
  return Array.from(new Set((items ?? []).map((i) => i.productId).filter((v): v is string => Boolean(v))));
}

// ============================================================
// PurchaseOrder —— 新建
// ============================================================

export function createPurchaseOrderAggregate<I extends Prisma.PurchaseOrderInclude>(
  input: {
    /** 明细入参（用于加锁与上下文加载；判定由 `plan` 完成） */
    rawItems: ReadonlyArray<{ productId?: string | null; productionOrderItemId?: string | null }> | undefined;
    visibilityWhere: Prisma.ProductWhereInput;
    /** 表头字段（不含 purchaseNo / items / totalAmount / totalAmountCny —— 由本层与 plan 产出） */
    header: Omit<
      Prisma.PurchaseOrderUncheckedCreateInput,
      'purchaseNo' | 'items' | 'totalAmount' | 'totalAmountCny'
    >;
    /** 汇总本币金额的计算（金额口径在 Business，算子在 utils） */
    toTotalCny: (total: Prisma.Decimal) => Prisma.Decimal | null;
    plan: BuildItemsPlan;
    include: I;
  },
): Promise<{ order: Prisma.PurchaseOrderGetPayload<{ include: I }>; itemCount: number }> {
  return runInTransaction(async (tx) => {
    // 并发硬化：**先锁定**成本归集链上的 ProductionOrderItem，再做引用校验与写入，
    // 否则并发删除生产明细时 FK 的 onDelete: SetNull 会在校验通过后静默解绑（镜像 TOCTOU）。
    await productionOrderRepository.lockItemsForUpdate(
      productionItemIdsOf(input.rawItems),
      tx,
    );

    const requestedProductIds = productIdsOf(input.rawItems);
    const productionItems = productionItemIdsOf(input.rawItems).length
      ? await productionOrderRepository.findItemsByIds(productionItemIdsOf(input.rawItems), tx)
      : [];

    const visibleProductIds = requestedProductIds.length
      ? (await productRepository.findIdsByVisibility(requestedProductIds, input.visibilityWhere, tx)).map(
          (p) => p.id,
        )
      : [];

    const planResult = input.plan({
      requestedProductIds,
      visibleProductIds,
      productionItems,
    });
    if (!planResult.ok) throw toDomainError(planResult);

    const purchaseNo = await getNextNumber(tx, 'PR');
    const order = await purchaseOrderRepository.create(
      {
        data: {
          ...input.header,
          purchaseNo,
          totalAmount: planResult.total,
          totalAmountCny: input.toTotalCny(planResult.total),
          ...(planResult.data.length > 0 ? { items: { create: planResult.data } } : {}),
        },
        include: input.include,
      },
      tx,
    );

    return { order, itemCount: planResult.data.length };
  });
}

// ============================================================
// PurchaseOrder —— 更新（明细重建 + 汇总重算，原子）
// ============================================================

export function updatePurchaseOrderAggregate<I extends Prisma.PurchaseOrderInclude>(
  input: {
    id: string;
    /** 新明细入参；`null` 表示本次不改明细 */
    rawItems: ReadonlyArray<{ productId?: string | null; productionOrderItemId?: string | null }> | null;
    visibilityWhere: Prisma.ProductWhereInput;
    /** 改明细时的判定函数（纯业务） */
    plan: BuildItemsPlan | null;
    /**
     * 由 Business 依据 plan 结果 / 币种汇率变化决定最终写入字段（纯函数）。
     * 入参已收窄为**成功分支**（失败分支会在调用前抛错），避免 Business 二次判定 `ok`。
     */
    buildData: (plan: Extract<ItemsPlanResult, { ok: true }> | null) => Prisma.PurchaseOrderUncheckedUpdateInput;
    include: I;
  },
): Promise<Prisma.PurchaseOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    // BEGIN → read old items（取旧引用 id 与行级状态）
    //       → lock ProductionOrderItem(旧 ∪ 新, id ASC)
    //       → plan（存在性 / 跨工单绑定 / 明细构建）
    //       → update（含 deleteMany + create） → COMMIT
    const existingItems = await purchaseOrderRepository.findItemStatesByOrderId(input.id, tx);
    const preserveByLine = new Map<number, PreservedItemState>(
      existingItems.map((i) => [i.lineNo, { arrivedQty: i.arrivedQty, status: i.status }]),
    );

    await productionOrderRepository.lockItemsForUpdate(
      [
        ...existingItems.map((i) => i.productionOrderItemId),
        ...productionItemIdsOf(input.rawItems ?? undefined),
      ],
      tx,
    );

    let planResult: ItemsPlanResult | null = null;
    if (input.plan && input.rawItems !== null) {
      const requestedProductIds = productIdsOf(input.rawItems);
      const productionItemIds = productionItemIdsOf(input.rawItems);
      const [visibleProducts, productionItems] = await Promise.all([
        requestedProductIds.length
          ? productRepository.findIdsByVisibility(requestedProductIds, input.visibilityWhere, tx)
          : Promise.resolve([]),
        productionItemIds.length
          ? productionOrderRepository.findItemsByIds(productionItemIds, tx)
          : Promise.resolve([]),
      ]);

      planResult = input.plan({
        requestedProductIds,
        visibleProductIds: visibleProducts.map((p) => p.id),
        productionItems,
        preserveByLine,
      });
      if (!planResult.ok) throw toDomainError(planResult);
    }

    return purchaseOrderRepository.update(
      { where: { id: input.id }, data: input.buildData(planResult), include: input.include },
      tx,
    );
  });
}
