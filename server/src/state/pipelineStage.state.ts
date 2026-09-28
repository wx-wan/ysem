/**
 * 商机阶段（Pipeline Stage）派生规则 —— Round R-5 · Phase 3 · State Capability
 *
 * 【State 能力边界（冻结）】纯函数 / 纯常量：不访问 Prisma、不访问 HTTP、不承载编排。
 * 信号**装载**在 `repositories/opportunity.repository.ts`（Data），
 * 装载与派生的组合在 `operations/state.operations.ts`（Operation）。
 *
 * 【业务语义冻结（沿用既有实现，未改）】
 *   阶段**不落库**，统一由关联单据推导（V1.0）：
 *     有 Shipment        → SHIPPED
 *     有 ProductionOrder → PRODUCTION
 *     有 SalesOrder      → ORDER
 *     有 SampleOrder     → SAMPLE
 *     有 Quotation       → QUOTED
 *     否则               → OPPORTUNITY
 */

export type PipelineStage =
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'QUOTED'
  | 'SAMPLE'
  | 'PRODUCTION'
  | 'SHIPPED'
  | 'ORDER';

/**
 * 阶段优先级（数值越大越靠后）。
 *
 * 注意：V1.0 是「链式推进」（销售订单 → 生产 → 出运），
 * 而旧版 Order.type 是五个并列单据类型，因此旧版 ORDER(6) > SHIPPED(5) 的
 * 优先级在 V1.0 会让「生产/出运」两列永远为空（有出运必然已有销售订单）。
 * 此处按 V1.0 链式语义调整为 ORDER < PRODUCTION < SHIPPED。
 */
export const STAGE_ORDER: Record<PipelineStage, number> = {
  LEAD: 0,
  OPPORTUNITY: 1,
  QUOTED: 2,
  SAMPLE: 3,
  ORDER: 4,
  PRODUCTION: 5,
  SHIPPED: 6,
};

export const PIPELINE_STAGES = Object.keys(STAGE_ORDER) as PipelineStage[];

/** 推导阶段所需的关联单据信号 */
export interface OpportunityStageSignals {
  quotationCount?: number;
  sampleOrderCount?: number;
  hasSalesOrder?: boolean;
  hasProductionOrder?: boolean;
  hasShipment?: boolean;
}

/** 根据关联单据信号推导单个商机的阶段 */
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

/** 给单个商机附加 stage 字段（仅用于详情/看板展示；纯函数） */
export function withStage<T extends { id: string; leadId?: string | null }>(
  opportunity: T,
  stageMap?: Map<string, PipelineStage>,
): T & { stage: PipelineStage } {
  const stage = stageMap?.get(opportunity.id) ?? deriveStage(opportunity);
  return { ...opportunity, stage };
}
