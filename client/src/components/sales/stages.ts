// 商机阶段：不再落库，由后端按关联单据推导（server/src/utils/pipelineStage.ts）
// 阶段只读展示，不支持手动切换。
export type SalesStage = 'OPPORTUNITY' | 'QUOTED' | 'SAMPLE' | 'PRODUCTION' | 'SHIPPED' | 'ORDER';

export const SALES_STAGES: SalesStage[] = [
  'OPPORTUNITY',
  'QUOTED',
  'SAMPLE',
  'PRODUCTION',
  'SHIPPED',
  'ORDER',
];

/** i18n key 后缀，配合 t(`sales.stage.${x}`) 使用 */
export const STAGE_I18N: Record<SalesStage, string> = {
  OPPORTUNITY: 'opportunity',
  QUOTED: 'quoted',
  SAMPLE: 'sample',
  PRODUCTION: 'production',
  SHIPPED: 'shipped',
  ORDER: 'order',
};

export const STAGE_META: Record<
  SalesStage,
  { color: string; bg: string; border: string }
> = {
  OPPORTUNITY: { color: '#1677ff', bg: '#e6f4ff', border: '#91caff' },
  QUOTED: { color: '#08979c', bg: '#e6fffb', border: '#87e8de' },
  SAMPLE: { color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7' },
  PRODUCTION: { color: '#d46b08', bg: '#fff7e6', border: '#ffd591' },
  SHIPPED: { color: '#096dd9', bg: '#e6f7ff', border: '#91d5ff' },
  ORDER: { color: '#52c41a', bg: '#f6ffed', border: '#b7eb8f' },
};

export function getStageMeta(stage: string): { color: string; bg: string; border: string } {
  return STAGE_META[(stage as SalesStage)] ?? STAGE_META.OPPORTUNITY;
}

/** 取阶段的 i18n key，传入未知阶段时回退到商机 */
export function getStageI18nKey(stage: string): string {
  return STAGE_I18N[(stage as SalesStage)] ?? 'opportunity';
}
