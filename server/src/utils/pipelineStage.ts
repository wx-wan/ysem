import prisma from '../lib/prisma';

/**
 * 商机阶段：不再落库，统一由关联单据推导（V1.0）。
 *
 * V1.0 中 SalesPipeline 已被 Opportunity 取代；履约链为
 *   Opportunity → Quotation / SampleOrder → SalesOrder → ProductionOrder → Shipment
 * 阶段由以下信号推导：
 *   有 Quotation      → QUOTED
 *   有 SampleOrder    → SAMPLE
 *   有 SalesOrder     → ORDER
 *   有 ProductionOrder→ PRODUCTION
 *   有 Shipment       → SHIPPED
 *   否则              → OPPORTUNITY
 */
export type PipelineStage = 'LEAD' | 'OPPORTUNITY' | 'QUOTED' | 'SAMPLE' | 'PRODUCTION' | 'SHIPPED' | 'ORDER';

/**
 * 阶段优先级（数值越大越靠后）。
 *
 * 注意：V1.0 是「链式推进」（销售订单 → 生产 → 出运），
 * 而旧版 Order.type 是五个并列单据类型，因此旧版 ORDER(6) > SHIPPED(5) 的
 * 优先级在 V1.0 会让「生产/出运」两列永远为空（有出运必然已有销售订单）。
 * 此处按 V1.0 链式语义调整为 ORDER < PRODUCTION < SHIPPED。
 */
const STAGE_ORDER: Record<PipelineStage, number> = {
  LEAD: 0,
  OPPORTUNITY: 1,
  QUOTED: 2,
  SAMPLE: 3,
  ORDER: 4,
  PRODUCTION: 5,
  SHIPPED: 6,
};

export { STAGE_ORDER };

export const PIPELINE_STAGES = Object.keys(STAGE_ORDER) as PipelineStage[];

/** 推导阶段所需的关联单据信号 */
export interface OpportunityStageSignals {
  quotationCount?: number;
  sampleOrderCount?: number;
  hasSalesOrder?: boolean;
  hasProductionOrder?: boolean;
  hasShipment?: boolean;
}

/**
 * 根据关联单据信号推导单个商机的阶段。
 */
export function deriveStage(
  opportunity: { id: string; leadId?: string | null },
  signals?: OpportunityStageSignals,
): PipelineStage {
  if (signals) {
    if (signals.hasShipment) return 'SHIPPED';
    if (signals.hasProductionOrder) return 'PRODUCTION';
    if (signals.hasSalesOrder) return 'ORDER';
    if ((signals.sampleOrderCount ?? 0) > 0) return 'SAMPLE';
    if ((signals.quotationCount ?? 0) > 0) return 'QUOTED';
  }
  return 'OPPORTUNITY';
}

/**
 * 批量推导商机阶段。
 *
 * 只读取 V1.0 实体：Quotation / SampleOrder / SalesOrder（及其 ProductionOrder、Shipment），
 * 不再依赖已删除的旧 Order 模型。
 */
export async function deriveStages(
  opportunities: { id: string; leadId?: string | null }[],
): Promise<Map<string, PipelineStage>> {
  const result = new Map<string, PipelineStage>();
  if (opportunities.length === 0) return result;

  const ids = opportunities.map((o) => o.id);

  const [quotations, sampleOrders, salesOrders] = await Promise.all([
    prisma.quotation.groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.sampleOrder.groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.salesOrder.findMany({
      where: { opportunityId: { in: ids } },
      select: {
        opportunityId: true,
        productionOrders: { select: { id: true }, take: 1 },
        shipments: { select: { id: true }, take: 1 },
      },
    }),
  ]);

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
    const cur = salesSignals.get(so.opportunityId) ?? { hasProductionOrder: false, hasShipment: false };
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
      }),
    );
  }

  return result;
}

/**
 * 给单个商机附加 stage 字段（仅用于详情/看板展示）。
 */
export function withStage<T extends { id: string; leadId?: string | null }>(
  opportunity: T,
  stageMap?: Map<string, PipelineStage>,
): T & { stage: PipelineStage } {
  const stage = stageMap?.get(opportunity.id) ?? deriveStage(opportunity);
  return { ...opportunity, stage };
}
