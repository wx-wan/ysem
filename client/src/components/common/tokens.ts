import { Grid } from 'antd';

const { useBreakpoint } = Grid;

/**
 * 全局空间节奏 token（4-unit base scale）。
 * 收敛散落的卡片间距魔法数字（gutter 10/12/16/24 混用），
 * 让"卡片之间的间距"由一处调度，并随断点收缩/放开。
 *
 * 节奏：手机紧凑（12）→ 默认（16）→ 宽屏宽松（20），
 * 形成刻意的密度对比，而非单一数值无差别重复。
 */

/** 4-unit base 间距梯度（px） */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  x2l: 32,
} as const;

/**
 * 卡片网格间距（行, 列）。
 * 作为所有卡片网格的单一调度源：通用组件默认引用，
 * 页面级卡片 Row 也应收敛到此，避免各页面自说自话。
 */
export const CARD_GRID = {
  gutter: [16, 16] as [number, number],
  gutterSm: [12, 12] as [number, number],
  gutterLg: [20, 20] as [number, number],
};

/**
 * 响应式卡片间距：[列间距, 行间距]。
 * 手机更紧凑、宽屏更宽松，统一由断点调度。
 */
export function useCardGutter(): [number, number] {
  const screens = useBreakpoint();
  if (screens.xs && !screens.sm) return CARD_GRID.gutterSm;
  if (screens.xl) return CARD_GRID.gutterLg;
  return CARD_GRID.gutter;
}
