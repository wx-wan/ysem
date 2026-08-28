import prisma from '../lib/prisma';

/**
 * 商机阶段：不再落库，统一由关联单据推导。
 *
 * 优先级（由后往前判断，越靠后越代表推进得更远）：
 *   1. ORDER       —— 已关联正式订单（Order.type = ORDER）
 *   2. SHIPPED     —— 已关联出货单（Order.type = SHIPPED）
 *   3. PRODUCTION  —— 已关联生产单（Order.type = PRODUCTION）
 *   4. SAMPLE      —— 已关联打样单（Order.type = SAMPLE）
 *   5. QUOTED      —— 已关联报价单（Order.type = QUOTE / Quotation）
 *   6. OPPORTUNITY —— 已由线索确认转来（绑定了 leadId）或已建档
 *   7. LEAD        —— 仅线索，尚未转为商机
 */
export type PipelineStage =
  | 'LEAD'
  | 'OPPORTUNITY'
  | 'QUOTED'
  | 'SAMPLE'
  | 'PRODUCTION'
  | 'SHIPPED'
  | 'ORDER';

/** 阶段优先级，数值越大推进得越靠后 */
const STAGE_ORDER: Record<PipelineStage, number> = {
  LEAD: 0,
  OPPORTUNITY: 1,
  QUOTED: 2,
  SAMPLE: 3,
  PRODUCTION: 4,
  SHIPPED: 5,
  ORDER: 6,
};

export const PIPELINE_STAGES = Object.keys(STAGE_ORDER) as PipelineStage[];

/** Order.type → 商机阶段 */
const ORDER_TYPE_STAGE: Record<string, PipelineStage> = {
  QUOTE: 'QUOTED',
  SAMPLE: 'SAMPLE',
  PRODUCTION: 'PRODUCTION',
  SHIPPED: 'SHIPPED',
  ORDER: 'ORDER',
};

/**
 * 根据关联单据推导单个商机的阶段。
 * @param pipeline 需包含 leadId
 * @param orders   该商机关联的订单（只需 type 字段）；不传则自动查询
 * @param quotationCount 该商机关联的报价数量；不传则自动查询
 */
export function deriveStage(
  pipeline: { id: string; leadId?: string | null },
  orders?: { type: string }[],
  quotationCount?: number,
): PipelineStage {
  // 已关联的最高阶单据决定阶段
  if (orders?.length) {
    let best: PipelineStage | null = null;
    for (const o of orders) {
      const st = ORDER_TYPE_STAGE[o.type];
      if (st && (best === null || STAGE_ORDER[st] > STAGE_ORDER[best])) best = st;
    }
    if (best) return best;
    return 'OPPORTUNITY';
  }
  if (quotationCount !== undefined && quotationCount > 0) return 'QUOTED';
  // 绑定了来源线索，说明已由线索确认转为商机
  if (pipeline.leadId) return 'OPPORTUNITY';
  return 'OPPORTUNITY';
}

/**
 * 批量推导阶段：一次查库拿到所有商机的关联订单与报价，避免 N+1。
 * @returns Map<pipelineId, stage>
 */
export async function deriveStages(
  pipelines: { id: string; leadId?: string | null }[],
): Promise<Map<string, PipelineStage>> {
  const result = new Map<string, PipelineStage>();
  if (pipelines.length === 0) return result;

  const ids = pipelines.map((p) => p.id);

  const [orders, quotations] = await Promise.all([
    prisma.order.findMany({
      where: { pipelineId: { in: ids } },
      select: { pipelineId: true, type: true },
    }),
    prisma.quotation.groupBy({
      by: ['opportunityId'],
      where: { opportunityId: { in: ids } },
      _count: { _all: true },
    }),
  ]);

  const ordersByPid = new Map<string, { type: string }[]>();
  for (const o of orders) {
    if (!o.pipelineId) continue;
    const arr = ordersByPid.get(o.pipelineId) ?? [];
    arr.push({ type: o.type });
    ordersByPid.set(o.pipelineId, arr);
  }

  const quoteCountByPid = new Map<string, number>();
  for (const q of quotations) {
    quoteCountByPid.set(q.opportunityId, q._count._all);
  }

  for (const p of pipelines) {
    result.set(
      p.id,
      deriveStage(p, ordersByPid.get(p.id), quoteCountByPid.get(p.id) ?? 0),
    );
  }
  return result;
}

/** 给商机列表/详情附加 stage 字段（派生，不落库） */
export function withStage<T extends { id: string; leadId?: string | null }>(
  pipeline: T,
  stage: PipelineStage,
): T & { stage: PipelineStage } {
  return { ...pipeline, stage };
}

export { STAGE_ORDER };
