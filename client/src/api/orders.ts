import request, { type ApiResponse } from './request';

// ========== 单据类型配置 ==========
// 类型：报价单 / 打样单 / 正式订单 / 生产单 / 出货单
// 打样阶段（仅 SAMPLE）：设计 → 开模 → 寄样

export type OrderType =
  | 'QUOTE'
  | 'SAMPLE'
  | 'ORDER'
  | 'PRODUCTION'
  | 'SHIPPED';

// 销售记录 Tab 类型（含独立单据：付款单 / 利润单）
export type SalesRecordTab =
  | OrderType
  | 'PAYMENT'
  | 'PROFIT';

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

// ========== 数据接口 ==========

/** 单据（Order）记录 */
export interface Order {
  id: string;
  orderNo: string;
  type: OrderType;
  title?: string | null;
  customerId?: string | null;
  amount?: number | null;
  stage?: string | null;
  status?: string | null;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type PaymentStatus = 'RECEIVED' | 'PENDING' | 'REFUNDED';

/** 付款单（收款记录） */
export interface PaymentRecord {
  id: string;
  paymentNo: string;
  orderId: string;
  customerId?: string | null;
  payDate?: string | null;
  amount?: number | null;   // 收款金额
  ratio?: number | null;    // 收款比例（%）
  method?: string | null;   // 收款方式
  status: PaymentStatus;
  remark?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  customer?: { id: string; companyName: string } | null;
  order?: { id: string; orderNo: string; title?: string | null } | null;
}

export type PaymentForm = Partial<Pick<PaymentRecord,
  'payDate' | 'amount' | 'ratio' | 'method' | 'status' | 'remark'>> & { orderId: string };

/** 利润单（利润核算） */
export interface ProfitRecord {
  id: string;
  profitNo: string;
  orderId: string;
  customerId?: string | null;
  revenue?: number | null;  // 收入
  cost?: number | null;     // 成本
  profit?: number | null;   // 利润 = 收入 - 成本
  margin?: number | null;   // 利润率（%）
  currency?: string | null;
  remark?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
  customer?: { id: string; companyName: string } | null;
  order?: { id: string; orderNo: string; title?: string | null } | null;
}

export type ProfitForm = Partial<Pick<ProfitRecord,
  'revenue' | 'cost' | 'currency' | 'remark'>> & { orderId: string };

// ========== API ==========

export const orderApi = {
  // 按客户查询单据列表
  listByCustomer: (customerId: string, type?: OrderType) =>
    request.get<ApiResponse<Order[]>>('/orders/customer/' + customerId, {
      params: type ? { type } : {},
    }),

  // 付款单（收款记录）
  listPayments: (params?: { orderId?: string; customerId?: string }) =>
    request.get<ApiResponse<PaymentRecord[]>>('/orders/payments', { params }),
  createPayment: (data: PaymentForm) =>
    request.post<ApiResponse<PaymentRecord>>('/orders/payments', data),
  updatePayment: (id: string, data: Partial<PaymentForm>) =>
    request.put<ApiResponse<PaymentRecord>>('/orders/payments/' + id, data),
  removePayment: (id: string) =>
    request.delete<ApiResponse<null>>('/orders/payments/' + id),

  // 利润单（利润核算）
  listProfits: (params?: { orderId?: string; customerId?: string }) =>
    request.get<ApiResponse<ProfitRecord[]>>('/orders/profits', { params }),
  createProfit: (data: ProfitForm) =>
    request.post<ApiResponse<ProfitRecord>>('/orders/profits', data),
  updateProfit: (id: string, data: Partial<ProfitForm>) =>
    request.put<ApiResponse<ProfitRecord>>('/orders/profits/' + id, data),
  removeProfit: (id: string) =>
    request.delete<ApiResponse<null>>('/orders/profits/' + id),
};
