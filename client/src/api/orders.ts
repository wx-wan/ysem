// ========== 订单 7 阶段流程配置 ==========
// 流程：预付款 → 下打样单 → 设计 → 开模 → 寄样 → 生产 → 出货

export type OrderStatus =
  | 'DEPOSIT'        // 预付款
  | 'SAMPLE_ORDER'   // 下打样单
  | 'DESIGN'         // 设计
  | 'MOLD'           // 开模
  | 'SAMPLE_SENT'    // 寄样
  | 'PRODUCTION'     // 生产
  | 'SHIPPED';       // 出货

export interface OrderStageMeta {
  key: OrderStatus;
  label: string;       // 中文标签
  color: string;       // antd Tag 色
  accent: string;      // 看板列强调色（主色系递进）
}

// 看板列顺序即流程顺序
export const ORDER_STAGES: OrderStageMeta[] = [
  { key: 'DEPOSIT',      label: '预付款',   color: 'blue',   accent: '#1677ff' },
  { key: 'SAMPLE_ORDER', label: '下打样单', color: 'cyan',   accent: '#13c2c2' },
  { key: 'DESIGN',       label: '设计',     color: 'geekblue', accent: '#2f54eb' },
  { key: 'MOLD',         label: '开模',     color: 'purple', accent: '#722ed1' },
  { key: 'SAMPLE_SENT',  label: '寄样',     color: 'gold',   accent: '#d48806' },
  { key: 'PRODUCTION',   label: '生产',     color: 'orange', accent: '#fa8c16' },
  { key: 'SHIPPED',      label: '出货',     color: 'green',  accent: '#52c41a' },
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
