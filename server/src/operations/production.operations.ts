import type { Prisma } from '@prisma/client';
import { DomainConflictError } from '../lib/errors';
import { getNextNumber } from '../lib/numberSequence';
import {
  productionOrderRepository,
  qualityInspectionRepository,
  runInTransaction,
} from '../repositories';

/**
 * Production & QC Operation Layer —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * 职责：**事务编排** + 「编号分配」+「明细重建的引用保护临界区」。
 *
 * 不负责业务口径：明细快照 / 数量校验 / 进度派生 / 状态机 / exactly-one owner 全在
 * `services/productionOrder.service.ts` 与 `services/qualityInspection.service.ts`（Business），
 * 且**在事务之外**先行完成（与迁移前一致：`parseItems` 原本即位于 `$transaction` 之前）。
 * 故本层无需业务回调注入。
 *
 * 【事务归属（Master Plan §12）】本文件是生产质量域 `$transaction` 的唯一归属地。
 */

// ============================================================
// ProductionOrder
// ============================================================

/** 新建生产工单：编号分配与业务写入同事务（业务失败 → 计数一并回滚，不产生编号空洞） */
export function createProductionOrderAggregate<I extends Prisma.ProductionOrderInclude>(input: {
  data: Omit<Prisma.ProductionOrderUncheckedCreateInput, 'productionNo'>;
  include: I;
}): Promise<Prisma.ProductionOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const productionNo = await getNextNumber(tx, 'PO');
    return productionOrderRepository.create(
      { data: { ...input.data, productionNo }, include: input.include },
      tx,
    );
  });
}

/**
 * 更新生产工单（局部更新；明细整表重建需先确认未被采购单引用）。
 *
 * 临界区顺序**不可颠倒**（否则仍是 TOCTOU）：
 *   BEGIN → lock ProductionOrderItem(id ASC) → read refCount → assert
 *         → deleteMany/create items → update ProductionOrder → COMMIT
 *
 * 若先读 refCount 再锁：并发创建引用同一批生产明细的 `PurchaseOrderItem` 时，
 * 检查通过后的 `deleteMany` 会由 FK `onDelete: SetNull` **静默解绑** ADR-14 成本归集链。
 * 先锁行后，并发 FK 插入会被 PostgreSQL 的 FOR KEY SHARE 阻塞至本事务提交，
 * 由「静默解绑」变为「显式失败」（P2003 → 4xx）。
 *
 * `refConflictMessage` 由 Business 提供（文案归属业务），本层只负责「有引用即拒绝」这一
 * 跨域完整性约束与判定时机。
 */
export function updateProductionOrderAggregate<I extends Prisma.ProductionOrderInclude>(input: {
  id: string;
  /** `null` 表示本次不重建明细 */
  itemRows: Prisma.ProductionOrderItemUncheckedCreateWithoutProductionOrderInput[] | null;
  data: Prisma.ProductionOrderUpdateInput;
  refConflictMessage: string;
  include: I;
}): Promise<Prisma.ProductionOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const data: Prisma.ProductionOrderUpdateInput = { ...input.data };

    if (input.itemRows !== null) {
      // 1) 取得本次将被删除的旧明细 id（加锁目标 + 引用计数范围）
      const existingItems = await productionOrderRepository.findItemIdsByOrderId(input.id, tx);
      const existingItemIds = existingItems.map((i) => i.id);

      // 2) **先锁行**（id ASC）：并发插入指向这些行的 PurchaseOrderItem 会被 FK 阻塞
      await productionOrderRepository.lockItemsForUpdate(existingItemIds, tx);

      // 3) 锁**之后**才读引用计数（顺序不可颠倒）
      const refCount = await productionOrderRepository.countPurchaseOrderItemRefs(existingItemIds, tx);
      if (refCount > 0) throw new DomainConflictError(input.refConflictMessage);

      data.items = { deleteMany: {}, create: input.itemRows };
    }

    return productionOrderRepository.update({ where: { id: input.id }, data, include: input.include }, tx);
  });
}

// ============================================================
// QualityInspection
// ============================================================

/** 新建质检单：编号分配与业务写入同事务（业务失败 → 计数一并回滚，不产生编号空洞） */
export function createQualityInspectionAggregate<I extends Prisma.QualityInspectionInclude>(input: {
  data: Omit<Prisma.QualityInspectionUncheckedCreateInput, 'inspectionNo'>;
  include: I;
}): Promise<Prisma.QualityInspectionGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const inspectionNo = await getNextNumber(tx, 'INS');
    return qualityInspectionRepository.create(
      { data: { ...input.data, inspectionNo }, include: input.include },
      tx,
    );
  });
}
