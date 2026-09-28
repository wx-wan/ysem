import type { Prisma, SampleOrder, SampleRound, SalesOrder } from '@prisma/client';
import { getNextNumber } from '../lib/numberSequence';
import {
  customerRepository,
  opportunityRepository,
  quotationRepository,
  runInTransaction,
  salesOrderRepository,
  sampleOrderRepository,
  type TxClient,
} from '../repositories';

/**
 * Sales Operation Layer（Round R-5 · Phase 1 · Sales Process Domain Integration）
 *
 * 职责（**销售域横向能力**，非每模块一层）：多仓储组合、**事务编排**、
 * 编号分配与业务写入的同事务保证、销售履约事件驱动的跨域派生回写。
 *
 * 不负责：业务政策判断（「什么条件下允许创建 / 修改」由 services 决定）、HTTP、权限决策。
 *
 * 【冻结（Round R-5 · B6）】销售域**全部** `$transaction` 收敛在本文件；
 * Controller / Business 层不再出现 `$transaction`。
 *
 * 【冻结（Round R-5 · B5）】Customer 订单统计的唯一维护入口是本文件
 * （`syncCustomerOrderStats`）—— 采用**按订单事实回算**，而非增量加减，
 * 因此天然免疫「重复累计 / 重放事件 / 取消后未扣除 / 改额后未更新」。
 */

// ============================================================
// 共享口径
// ============================================================

/**
 * 「有效销售订单」口径（B5 冻结）：
 *
 *   status !== CANCELLED  ⇒ 计入 Customer 订单统计
 *   status === CANCELLED  ⇒ 不计入（并触发回算扣除）
 *
 * 说明：DRAFT 亦计入 —— 业务负责人的必避免清单只点名「取消订单仍计入」，
 * 未要求排除草稿；此口径写入 Phase 1 报告并作为后续可调整的单点。
 */
export const EFFECTIVE_SALES_ORDER_WHERE: Prisma.SalesOrderWhereInput = {
  status: { not: 'CANCELLED' },
};

// ============================================================
// Opportunity
// ============================================================

/** 创建商机：编号分配 + 落库同事务（业务失败 → 计数一并回滚，无编号空洞） */
export function createOpportunityAggregate<I extends Prisma.OpportunityInclude>(
  data: Omit<Prisma.OpportunityUncheckedCreateInput, 'opportunityNo'>,
  include: I,
): Promise<Prisma.OpportunityGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const opportunityNo = await getNextNumber(tx, 'OPP');
    return opportunityRepository.create({ data: { ...data, opportunityNo }, include }, tx) as unknown as Promise<
      Prisma.OpportunityGetPayload<{ include: I }>
    >;
  });
}

/** 创建商机（无 include，Excel 导入逐行事务用） */
export function createOpportunityRowAggregate(
  data: Omit<Prisma.OpportunityUncheckedCreateInput, 'opportunityNo'>,
): Promise<OpportunityRow> {
  return runInTransaction(async (tx) => {
    const opportunityNo = await getNextNumber(tx, 'OPP');
    return opportunityRepository.create({ data: { ...data, opportunityNo } }, tx) as Promise<OpportunityRow>;
  });
}

type OpportunityRow = Prisma.OpportunityGetPayload<Record<string, never>>;

/**
 * 更新商机。
 *
 * `replaceItems = true` ⇒「明细整表重建」：deleteMany + update 收在**同一事务**，
 * 保证不会出现「已删旧明细但主记录未更新」的中间态。
 */
export function updateOpportunityAggregate<I extends Prisma.OpportunityInclude>(
  input: {
    id: string;
    data: Prisma.OpportunityUncheckedUpdateInput;
    include: I;
    replaceItems: boolean;
  },
): Promise<Prisma.OpportunityGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    if (input.replaceItems) {
      await opportunityRepository.deleteItemsByOpportunityId(input.id, tx);
    }
    return opportunityRepository.update(
      { where: { id: input.id }, data: input.data, include: input.include },
      tx,
    ) as unknown as Promise<Prisma.OpportunityGetPayload<{ include: I }>>;
  });
}

// ============================================================
// Quotation
// ============================================================

/** 创建报价：编号分配 + 落库同事务 */
export function createQuotationAggregate<I extends Prisma.QuotationInclude>(
  data: Omit<Prisma.QuotationUncheckedCreateInput, 'quotationNo'>,
  include: I,
): Promise<Prisma.QuotationGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const quotationNo = await getNextNumber(tx, 'QUO');
    return quotationRepository.create({ data: { ...data, quotationNo }, include }, tx) as unknown as Promise<
      Prisma.QuotationGetPayload<{ include: I }>
    >;
  });
}

// ============================================================
// SampleOrder
// ============================================================

/** 创建打样单：编号分配 + 落库同事务（可同时带初始轮次） */
export function createSampleOrderAggregate<I extends Prisma.SampleOrderInclude>(
  data: Omit<Prisma.SampleOrderUncheckedCreateInput, 'sampleNo'>,
  include: I,
): Promise<Prisma.SampleOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const sampleNo = await getNextNumber(tx, 'SMP');
    return sampleOrderRepository.create({ data: { ...data, sampleNo }, include }, tx) as unknown as Promise<
      Prisma.SampleOrderGetPayload<{ include: I }>
    >;
  });
}

/** 新增打样轮次：轮次号自增 + 建轮次 + 同步 currentRound（同一事务） */
export function createSampleRoundAggregate(input: {
  sampleOrderId: string;
  updatedBy: string | null;
  roundData: Omit<Prisma.SampleRoundUncheckedCreateWithoutSampleOrderInput, 'roundNo'>;
}): Promise<SampleRound> {
  return runInTransaction(async (tx) => {
    const maxRoundNo = (await sampleOrderRepository.maxRoundNo(input.sampleOrderId, tx)) ?? 0;
    const roundNo = maxRoundNo + 1;
    const roundRow = await sampleOrderRepository.createRound(
      {
        data: { ...input.roundData, roundNo, sampleOrderId: input.sampleOrderId },
      },
      tx,
    );
    await sampleOrderRepository.update(
      { where: { id: input.sampleOrderId }, data: { currentRound: roundNo, updatedBy: input.updatedBy } },
      tx,
    );
    return roundRow;
  });
}

/** 删除打样轮次：删轮次 + 重算 currentRound（不指向不存在的轮次，同一事务） */
export function removeSampleRoundAggregate(input: {
  sampleOrderId: string;
  roundId: string;
  updatedBy: string | null;
}): Promise<SampleOrder> {
  return runInTransaction(async (tx) => {
    await sampleOrderRepository.deleteRound(input.roundId, tx);
    const maxRoundNo = await sampleOrderRepository.maxRoundNo(input.sampleOrderId, tx);
    return sampleOrderRepository.update(
      {
        where: { id: input.sampleOrderId },
        data: { currentRound: maxRoundNo ?? 1, updatedBy: input.updatedBy },
      },
      tx,
    );
  });
}

// ============================================================
// SalesOrder
// ============================================================

/** 创建销售订单：编号分配 + 落库 + Customer 订单统计回算（同一事务） */
export function createSalesOrderAggregate<I extends Prisma.SalesOrderInclude>(
  data: Omit<Prisma.SalesOrderUncheckedCreateInput, 'orderNo'>,
  include: I,
): Promise<Prisma.SalesOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    const orderNo = await getNextNumber(tx, 'SO');
    const order = (await salesOrderRepository.create(
      { data: { ...data, orderNo }, include },
      tx,
    )) as unknown as Prisma.SalesOrderGetPayload<{ include: I }>;

    if (data.customerId) await syncCustomerOrderStats(tx, data.customerId);
    return order;
  });
}

/**
 * 更新销售订单（局部更新；明细整表重建可选）+ Customer 订单统计回算。
 *
 * `affectedCustomerIds` 必须包含**变更前后**所有受影响客户：
 * 改客户 / 改金额 / 改状态 / 改 orderDate / 删明细 都可能影响统计。
 */
export function updateSalesOrderAggregate<I extends Prisma.SalesOrderInclude>(input: {
  id: string;
  data: Prisma.SalesOrderUncheckedUpdateInput;
  include: I;
  replaceItems: boolean;
  affectedCustomerIds: string[];
}): Promise<Prisma.SalesOrderGetPayload<{ include: I }>> {
  return runInTransaction(async (tx) => {
    if (input.replaceItems) {
      await salesOrderRepository.deleteItemsByOrderId(input.id, tx);
    }
    const order = (await salesOrderRepository.update(
      { where: { id: input.id }, data: input.data, include: input.include },
      tx,
    )) as unknown as Prisma.SalesOrderGetPayload<{ include: I }>;

    for (const customerId of unique(input.affectedCustomerIds)) {
      await syncCustomerOrderStats(tx, customerId);
    }
    return order;
  });
}

/** 删除销售订单 + Customer 订单统计回算（同一事务） */
export function removeSalesOrderAggregate(input: {
  id: string;
  affectedCustomerIds: string[];
}): Promise<SalesOrder> {
  return runInTransaction(async (tx) => {
    const removed = await salesOrderRepository.delete({ where: { id: input.id } }, tx);
    for (const customerId of unique(input.affectedCustomerIds)) {
      await syncCustomerOrderStats(tx, customerId);
    }
    return removed;
  });
}

/**
 * Customer 订单统计回算（B5 唯一维护入口）。
 *
 * 三项统计**全部**由「有效订单事实」重算，不做增量：
 *   firstOrderAt          = 最早有效订单的 (orderDate ?? createdAt)
 *   lastOrderAt           = 最近有效订单的 (orderDate ?? createdAt)
 *   totalOrderAmountCny   = 全部有效订单 totalAmountCny 之和（无订单 ⇒ 0）
 *
 * 幂等：重复执行结果一致 ⇒ 重放事件不会重复累计。
 */
export async function syncCustomerOrderStats(tx: TxClient, customerId: string): Promise<void> {
  const stats = await salesOrderRepository.aggregateCustomerOrderStats(
    customerId,
    EFFECTIVE_SALES_ORDER_WHERE,
    tx,
  );
  await customerRepository.update(
    {
      where: { id: customerId },
      data: {
        firstOrderAt: stats.firstOrderAt,
        lastOrderAt: stats.lastOrderAt,
        totalOrderAmountCny: stats.totalOrderAmountCny,
      },
    },
    tx,
  );
}

// ============================================================
// 内部工具
// ============================================================

function unique(ids: string[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}
