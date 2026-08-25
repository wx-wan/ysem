// ========== 单据类型配置 ==========
// 类型：报价单 / 打样单 / 正式订单 / 生产单 / 出货单
// 打样阶段（仅 SAMPLE）：设计 → 开模 → 寄样

export type OrderType =
  | 'QUOTE'
  | 'SAMPLE'
  | 'ORDER'
  | 'PRODUCTION'
  | 'SHIPPED';

export interface OrderTypeMeta {
  key: OrderType;
  label: string;
  color: string;
}

// 顶部 Tab 展示的销售记录类型
export const ORDER_TYPES: OrderTypeMeta[] = [
  { key: 'QUOTE', label: '报价单', color: 'blue' },
  { key: 'SAMPLE', label: '打样单', color: 'cyan' },
  { key: 'ORDER', label: '正式订单', color: 'green' },
  { key: 'PRODUCTION', label: '生产单', color: 'orange' },
  { key: 'SHIPPED', label: '出货单', color: 'purple' },
];

export const ORDER_TYPE_MAP: Record<OrderType, OrderTypeMeta> = ORDER_TYPES.reduce(
  (acc, s) => { acc[s.key] = s; return acc; }, {} as Record<OrderType, OrderTypeMeta>,
);

export function getOrderTypeMeta(t?: string | null): OrderTypeMeta {
  if (t && ORDER_TYPE_MAP[t as OrderType]) return ORDER_TYPE_MAP[t as OrderType];
  return ORDER_TYPES[2];
}

export type OrderStatus =
  | 'DESIGN'         // 设计
  | 'MOLD'           // 开模
  | 'SAMPLE_SENT';   // 寄样

export interface OrderStageMeta {
  key: OrderStatus;
  label: string;       // 中文标签
  color: string;       // antd Tag 色
  accent: string;      // 看板列强调色（主色系递进）
}

// 看板列顺序即打样流程顺序（仅 SAMPLE 使用）
export const ORDER_STAGES: OrderStageMeta[] = [
  { key: 'DESIGN',       label: '设计',     color: 'geekblue', accent: '#2f54eb' },
  { key: 'MOLD',         label: '开模',     color: 'purple', accent: '#722ed1' },
  { key: 'SAMPLE_SENT',  label: '寄样',     color: 'gold',   accent: '#d48806' },
];

export const ORDER_STATUS_MAP: Record<OrderStatus, OrderStageMeta> = ORDER_STAGES.reduce(
  (acc, s) => { acc[s.key] = s; return acc; }, {} as Record<OrderStatus, OrderStageMeta>,
);

export function getOrderStatusMeta(status?: string | null): OrderStageMeta {
  if (status && ORDER_STATUS_MAP[status as OrderStatus]) return ORDER_STATUS_MAP[status as OrderStatus];
  return ORDER_STAGES[0];
}

// 流程推进：返回下一阶段（已是最后一阶段则返回 null）
export function nextOrderStatus(status?: string | null): OrderStatus | null {
  const idx = ORDER_STAGES.findIndex((s) => s.key === status);
  if (idx < 0 || idx >= ORDER_STAGES.length - 1) return null;
  return ORDER_STAGES[idx + 1].key;
}
