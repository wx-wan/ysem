// 商机阶段定义（线索→商机→样品单→订单，与后端 salesPipeline.stage 枚举严格对齐）
export type SalesStage = 'LEAD' | 'OPPORTUNITY' | 'SAMPLE' | 'ORDER';

export const SALES_STAGES: SalesStage[] = ['LEAD', 'OPPORTUNITY', 'SAMPLE', 'ORDER'];

export const STAGE_META: Record<
  SalesStage,
  { label: string; color: string; bg: string; border: string; next?: SalesStage }
> = {
  LEAD: { label: '线索', color: '#8c8c8c', bg: 'rgba(0,0,0,0.04)', border: '#d9d9d9', next: 'OPPORTUNITY' },
  OPPORTUNITY: { label: '商机', color: '#1677ff', bg: '#e6f4ff', border: '#91caff', next: 'SAMPLE' },
  SAMPLE: { label: '样品单', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7', next: 'ORDER' },
  ORDER: { label: '订单', color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f' },
};

export function getStageMeta(stage: string): { label: string; color: string; bg: string; border: string; next?: SalesStage } {
  return STAGE_META[(stage as SalesStage)] ?? STAGE_META.LEAD;
}
