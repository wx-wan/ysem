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
 *     商机字段被编辑过   → FOLLOWING（跟进中）
 *     否则               → OPPORTUNITY（待处理）
 *
 *   FOLLOWING = 「无任何下游单据，但商机字段已被编辑过」：
 *   编辑事实来自 OperationLog（action=OPPORTUNITY_UPDATED，兼容旧 PIPELINE_UPDATED），
 *   因此同样是**读时派生**的结论，不落库；有单据时以单据阶段为准（不因跟进降级）。
 */

export type PipelineStage =
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'FOLLOWING'
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
  FOLLOWING: 2,
  QUOTED: 3,
  SAMPLE: 4,
  ORDER: 5,
  PRODUCTION: 6,
  SHIPPED: 7,
};

export const PIPELINE_STAGES = Object.keys(STAGE_ORDER) as PipelineStage[];

/** 推导阶段所需的关联单据信号 */
export interface OpportunityStageSignals {
  quotationCount?: number;
  sampleOrderCount?: number;
  hasSalesOrder?: boolean;
  hasProductionOrder?: boolean;
  hasShipment?: boolean;
  /** 商机字段是否被编辑过（OperationLog 存在 OPPORTUNITY_UPDATED / PIPELINE_UPDATED） */
  hasEditLog?: boolean;
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
    // 商机字段被编辑过 ⇒ 跟进中（在单据阶段之后判定：有单据时以单据为准，不因编辑而降级）
    if (signals.hasEditLog) return 'FOLLOWING';
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
