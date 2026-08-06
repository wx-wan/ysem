// 销售阶段统一配色锁 —— 全局唯一真源
// 使用 antd Tag 预设色名（blue/gold/purple/green），避免在组件中散落 hex，
// 既统一又可随主题语义联动（符合 impeccable 配色锁 / taste 反 slop 纪律）。
export type StageKey = 'LEAD' | 'OPPORTUNITY' | 'ORDER';

export interface SalesStage {
  key: StageKey;
  label: string;
  /** antd Tag 预设色名 */
  tagColor: string;
  /** 语义状态色（用于点点/图表） */
  color: string;
  /** 浅色背景（用于阶段徽标底） */
  bg: string;
}

export const SALES_STAGES: SalesStage[] = [
  { key: 'LEAD', label: '线索', tagColor: 'blue', color: '#1677ff', bg: '#eff6ff' },
  { key: 'OPPORTUNITY', label: '商机', tagColor: 'gold', color: '#f59e0b', bg: '#fffbeb' },
  { key: 'ORDER', label: '订单', tagColor: 'green', color: '#10b981', bg: '#ecfdf5' },
];

export const STAGE_MAP: Record<string, SalesStage> = SALES_STAGES.reduce(
  (acc, s) => ({ ...acc, [s.key]: s }),
  {} as Record<string, SalesStage>,
);

export const STAGE_LABELS: Record<string, string> = SALES_STAGES.reduce(
  (acc, s) => ({ ...acc, [s.key]: s.label }),
  {} as Record<string, string>,
);

export const getStage = (key?: string): SalesStage | undefined =>
  key ? STAGE_MAP[key] : undefined;
