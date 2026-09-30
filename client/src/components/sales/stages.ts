import type { ReactNode } from 'react';
import { STATUS_DOT } from '../common/statusDot';

// 商机阶段：不再落库，由后端按关联单据 + 编辑留痕推导（server/src/state/pipelineStage.state.ts）
// 阶段只读展示，不支持手动切换。
export type SalesStage =
  | 'OPPORTUNITY'
  | 'FOLLOWING'
  | 'QUOTED'
  | 'SAMPLE'
  | 'PRODUCTION'
  | 'SHIPPED'
  | 'ORDER';

export const SALES_STAGES: SalesStage[] = [
  'OPPORTUNITY',
  'FOLLOWING',
  'QUOTED',
  'SAMPLE',
  'PRODUCTION',
  'SHIPPED',
  'ORDER',
];

/** i18n key 后缀，配合 t(`sales.stage.${x}`) 使用 */
export const STAGE_I18N: Record<SalesStage, string> = {
  OPPORTUNITY: 'opportunity',
  FOLLOWING: 'following',
  QUOTED: 'quoted',
  SAMPLE: 'sample',
  PRODUCTION: 'production',
  SHIPPED: 'shipped',
  ORDER: 'order',
};

/**
 * 阶段展示元数据。
 * - `color`：antd Tag 颜色 —— 待处理=warning（待办）/ 跟进中=processing（处理中）/
 *   已报价=次要灰（与线索「已确认」及「客户类型」标签同色） ，其余阶段沿用原色；
 * - `chartColor`：同色系十六进制值 —— 语义色名不是合法图表颜色，阶段分布图专用；
 * - `icon`：统一为状态圆点（与看板「近期订单」同款 6px 圆点，颜色跟随标签文字色）。
 */
export const STAGE_META: Record<
  SalesStage,
  { color: string; chartColor: string; icon: ReactNode }
> = {
  // 待处理
  OPPORTUNITY: { color: 'warning', chartColor: '#faad14', icon: STATUS_DOT },
  // 跟进中
  FOLLOWING: { color: 'processing', chartColor: '#1677ff', icon: STATUS_DOT },
  // 已报价（与「已确认」同一灰：次要灰 --c-text-secondary）
  QUOTED: { color: '#64748b', chartColor: '#64748b', icon: STATUS_DOT },
  SAMPLE: { color: 'purple', chartColor: '#722ed1', icon: STATUS_DOT },
  PRODUCTION: { color: 'orange', chartColor: '#d46b08', icon: STATUS_DOT },
  SHIPPED: { color: 'blue', chartColor: '#096dd9', icon: STATUS_DOT },
  ORDER: { color: 'green', chartColor: '#52c41a', icon: STATUS_DOT },
};

export function getStageMeta(stage: string): { color: string; chartColor: string; icon: ReactNode } {
  return STAGE_META[(stage as SalesStage)] ?? STAGE_META.OPPORTUNITY;
}

/** 取阶段的 i18n key，传入未知阶段时回退到商机 */
export function getStageI18nKey(stage: string): string {
  return STAGE_I18N[(stage as SalesStage)] ?? 'opportunity';
}
