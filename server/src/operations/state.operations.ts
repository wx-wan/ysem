import type { LeadStatus } from '@prisma/client';
import { leadRepository, operationLogRepository, opportunityRepository, quotationRepository, salesOrderRepository, sampleOrderRepository } from '../repositories';
import { deriveStage, shouldAdvanceLeadStatus, type PipelineStage } from '../state';
import { BUSINESS_TYPE } from '../lib/business-type';
import { refreshLeadCustomerSnapshotOperation } from './lead.operations';

/** 「商机字段被编辑过」的日志动作（现行动作 + 旧版动作，兼容历史数据） */
const OPPORTUNITY_EDIT_ACTIONS = ['OPPORTUNITY_UPDATED', 'PIPELINE_UPDATED'];

/**
 * State 相关的数据操作流程 —— Round R-5 · Phase 3 · Operation Layer
 *
 * 【为什么在这里，而不是在 State 里】
 *   State 能力（`src/state/`）是**纯规则**（不访问 Prisma / HTTP / 不编排）。
 *   「读取 → 判定 → 写入」「读取多表 → 组合信号」属于**多个 Data 操作的组合**，
 *   按 Master Plan §7 正是 Operation Layer 的职责。
 *
 * 【业务语义冻结（逐字沿用迁移前实现）】
 *   · 线索状态推进失败**不阻断**单据创建主流程（单据是权威，状态只是派生结论），
 *     仅记录日志 —— 该容错语义在迁移中完整保留；
 *   · 状态只进不退：目标状态不高于当前状态时为 no-op（幂等，不重复写入）；
 *   · 商机阶段为**派生值**，不落库。
 */

/**
 * 把线索推进到目标状态：已处于同级 / 更高状态时不变（不降级）。
 * 失败不抛出（仅记录），确保不阻断调用方的单据创建主流程。
 */
export async function advanceLeadStatusOperation(
  leadId: string | null | undefined,
  next: LeadStatus,
): Promise<void> {
  if (!leadId) return;
  try {
    const lead = await leadRepository.findUnique({
      where: { id: leadId },
      select: { id: true, status: true },
    });
    if (!lead) return;
    if (!shouldAdvanceLeadStatus(lead.status, next)) return;
    await leadRepository.update({ where: { id: leadId }, data: { status: next } });

    // 【客户快照】线索**确认**（NEW → CONFIRMED）时固化最后一版：
    // 确认前每次线索更新都会刷新快照，确认这一版即为最终留痕，之后不再改动。
    if (next === 'CONFIRMED') {
      const row = await leadRepository.findUnique({
        where: { id: leadId },
        select: { customerId: true },
      });
      await refreshLeadCustomerSnapshotOperation(leadId, row?.customerId ?? null);
    }
  } catch (err) {
    console.error('[leadStatus] advance failed', { leadId, next, err });
  }
}

/** 商机 → 线索 ID（单据只挂商机，线索经 Opportunity.leadId 间接追溯） */
export async function leadIdOfOpportunityOperation(
  opportunityId: string | null | undefined,
): Promise<string | null> {
  if (!opportunityId) return null;
  try {
    const opportunity = await opportunityRepository.findFirst({
      where: { id: opportunityId },
      select: { leadId: true },
    });
    return opportunity?.leadId ?? null;
  } catch (err) {
    console.error('[leadStatus] resolve opportunity failed', { opportunityId, err });
    return null;
  }
}

/** 建打样单 / 销售订单后，按商机追溯线索并推进状态 */
export async function advanceLeadStatusByOpportunityOperation(
  opportunityId: string | null | undefined,
  next: LeadStatus,
): Promise<void> {
  const leadId = await leadIdOfOpportunityOperation(opportunityId);
  await advanceLeadStatusOperation(leadId, next);
}

/**
 * 批量推导商机阶段。
 *
 * 只读取 V1.0 实体：Quotation / SampleOrder / SalesOrder（及其 ProductionOrder、Shipment），
 * 不再依赖已删除的旧 Order 模型。另读 OperationLog 判断「商机字段是否被编辑过」
 * （编辑过 ⇒ FOLLOWING / 跟进中，见 pipelineStage.state.ts）。四个信号查询并发执行，无 N+1。
 */
export async function deriveOpportunityStagesOperation(
  opportunities: { id: string; leadId?: string | null }[],
): Promise<Map<string, PipelineStage>> {
  const result = new Map<string, PipelineStage>();
  if (opportunities.length === 0) return result;

  const ids = opportunities.map((o) => o.id);

  const [quotations, sampleOrders, salesOrders, editLogs] = await Promise.all([
    quotationRepository.groupCountByOpportunityIds(ids),
    sampleOrderRepository.groupCountByOpportunityIds(ids),
    salesOrderRepository.findStageSignalsByOpportunityIds(ids),
    // 商机字段是否被编辑过（OperationLog 中 OPPORTUNITY_UPDATED / PIPELINE_UPDATED）
    operationLogRepository.groupCountByBusinessIds(ids, OPPORTUNITY_EDIT_ACTIONS, BUSINESS_TYPE.OPPORTUNITY),
  ]);

  const editedIds = new Set(
    editLogs.filter((row) => row._count > 0 && !!row.businessId).map((row) => row.businessId as string),
  );

  const quoteCount = new Map<string, number>();
  for (const q of quotations) {
    if (q.opportunityId) quoteCount.set(q.opportunityId, q._count._all);
  }

  const sampleCount = new Map<string, number>();
  for (const s of sampleOrders) {
    if (s.opportunityId) sampleCount.set(s.opportunityId, s._count._all);
  }

  const salesSignals = new Map<string, { hasProductionOrder: boolean; hasShipment: boolean }>();
  for (const so of salesOrders) {
    if (!so.opportunityId) continue;
    const cur =
      salesSignals.get(so.opportunityId) ?? { hasProductionOrder: false, hasShipment: false };
    if (so.productionOrders.length > 0) cur.hasProductionOrder = true;
    if (so.shipments.length > 0) cur.hasShipment = true;
    salesSignals.set(so.opportunityId, cur);
  }

  for (const o of opportunities) {
    const so = salesSignals.get(o.id);
    result.set(
      o.id,
      deriveStage(o, {
        quotationCount: quoteCount.get(o.id) ?? 0,
        sampleOrderCount: sampleCount.get(o.id) ?? 0,
        hasSalesOrder: so !== undefined,
        hasProductionOrder: so?.hasProductionOrder ?? false,
        hasShipment: so?.hasShipment ?? false,
        hasEditLog: editedIds.has(o.id),
      }),
    );
  }

  return result;
}
