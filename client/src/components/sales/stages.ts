import { createElement, type ReactNode } from 'react';
import {
  CarOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  FileDoneOutlined,
  ShoppingCartOutlined,
  SyncOutlined,
  ToolOutlined,
} from '@ant-design/icons';

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
 * - `color`：antd Tag 语义色（待处理=error / 跟进中=processing / 已报价=success）；
 * - `chartColor`：同色系十六进制值 —— 语义色名不是合法图表颜色，阶段分布图专用；
 * - `icon`：状态标签前缀图标（不依赖颜色也能辨识状态）。
 */
export const STAGE_META: Record<
  SalesStage,
  { color: string; chartColor: string; icon: ReactNode }
> = {
  // 待处理
  OPPORTUNITY: { color: 'error', chartColor: '#ff4d4f', icon: createElement(ClockCircleOutlined) },
  // 跟进中
  FOLLOWING: { color: 'processing', chartColor: '#1677ff', icon: createElement(SyncOutlined) },
  // 已报价
  QUOTED: { color: 'success', chartColor: '#52c41a', icon: createElement(FileDoneOutlined) },
  SAMPLE: { color: 'purple', chartColor: '#722ed1', icon: createElement(ExperimentOutlined) },
  PRODUCTION: { color: 'orange', chartColor: '#d46b08', icon: createElement(ToolOutlined) },
  SHIPPED: { color: 'blue', chartColor: '#096dd9', icon: createElement(CarOutlined) },
  ORDER: { color: 'green', chartColor: '#52c41a', icon: createElement(ShoppingCartOutlined) },
};

export function getStageMeta(stage: string): { color: string; chartColor: string; icon: ReactNode } {
  return STAGE_META[(stage as SalesStage)] ?? STAGE_META.OPPORTUNITY;
}

/** 取阶段的 i18n key，传入未知阶段时回退到商机 */
export function getStageI18nKey(stage: string): string {
  return STAGE_I18N[(stage as SalesStage)] ?? 'opportunity';
}
