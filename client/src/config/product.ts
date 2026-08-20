// 供货模式选项（产品卡片 / 列表 / 编辑表单共用）
export const SUPPLY_MODES = [
  { label: '深度定制', value: 'DEEP_CUSTOM' },
  { label: '轻定制', value: 'LIGHT_CUSTOM' },
  { label: '成品现货', value: 'STOCK' },
];

export type SupplyModeValue = 'DEEP_CUSTOM' | 'LIGHT_CUSTOM' | 'STOCK';
