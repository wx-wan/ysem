import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 销售订单（SalesOrder）==========
// 后端：/api/sales-orders（V1.0 controller），编号 SO → SO-yyyyMMdd-0001（NumberSequence 生成）。
// 注意：金额 / 数量列在数据库为 Decimal，经 JSON 序列化后到达前端为「字符串」。
// 注意：订单编号字段为 orderNo（**不是** salesOrderNo）。

export type SalesOrderStatus =
  | 'DRAFT'
  | 'CONFIRMED'
  | 'DEPOSIT_PENDING'
  | 'DEPOSIT_PAID'
  | 'IN_PRODUCTION'
  | 'QC'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED';

export const SALES_ORDER_STATUS_TEXT: Record<SalesOrderStatus, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  DEPOSIT_PENDING: '待收定金',
  DEPOSIT_PAID: '定金已收',
  IN_PRODUCTION: '生产中',
  QC: '质检中',
  READY_TO_SHIP: '待出运',
  SHIPPED: '已出运',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const SALES_ORDER_STATUS_COLOR: Record<SalesOrderStatus, string> = {
  DRAFT: 'default',
  CONFIRMED: 'processing',
  DEPOSIT_PENDING: 'warning',
  DEPOSIT_PAID: 'cyan',
  IN_PRODUCTION: 'geekblue',
  QC: 'purple',
  READY_TO_SHIP: 'gold',
  SHIPPED: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

/** 履约主状态机的推进顺序（CANCELLED 为分支终态，不入主链） */
export const SALES_ORDER_FLOW: SalesOrderStatus[] = [
  'DRAFT',
  'CONFIRMED',
  'DEPOSIT_PENDING',
  'DEPOSIT_PAID',
  'IN_PRODUCTION',
  'QC',
  'READY_TO_SHIP',
  'SHIPPED',
  'COMPLETED',
];

/** 主链上的下一状态（已是终态 / 取消则返回 null） */
export function nextSalesOrderStatus(status?: string | null): SalesOrderStatus | null {
  const idx = SALES_ORDER_FLOW.findIndex((s) => s === status);
  if (idx < 0 || idx >= SALES_ORDER_FLOW.length - 1) return null;
  return SALES_ORDER_FLOW[idx + 1];
}

/** 销售订单明细（快照字段，ADR-04） */
export interface SalesOrderItem {
  id: string;
  orderId: string;
  lineNo: number;
  productId?: string | null;
  customerProductId?: string | null;
  productName: string;
  productSku?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  material?: string | null;
  packaging?: string | null;
  colors: string[];
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  currency: string;
  costPrice?: string | null;
  costAmount?: string | null;
  deliveryDate?: string | null;
  /** 已出货数量（由 ShipmentItem 汇总回写） */
  shippedQty: string;
  remark?: string | null;
  sort: number;
}

/** 销售订单 */
export interface SalesOrder {
  id: string;
  orderNo: string;
  opportunityId: string;
  opportunity?: { id: string; opportunityNo: string; title: string } | null;
  /** 商业来源报价单（可空）；Quotation 1:N SalesOrder */
  quotationId?: string | null;
  quotation?: { id: string; quotationNo: string; title: string } | null;
  customerId: string;
  customer?: { id: string; customerNo: string; companyName: string } | null;
  /** 来源打样单（可空）；SampleOrder 1:N SalesOrder */
  sampleOrderId?: string | null;
  sampleOrder?: { id: string; sampleNo: string; productName: string } | null;
  status: SalesOrderStatus;
  currency: string;
  exchangeRate?: string | null;
  totalAmount: string;
  totalAmountCny?: string | null;
  depositRatio?: string | null;
  depositAmount?: string | null;
  balanceAmount?: string | null;
  /** 已收累计（本位币），由 Payment(direction=IN, status=CONFIRMED) 汇总回写 */
  paidAmountCny: string;
  orderDate?: string | null;
  deliveryDate?: string | null;
  actualDeliveryDate?: string | null;
  tradeTerms?: string | null;
  paymentTerms?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  cancelReason?: string | null;
  remark?: string | null;
  ownerId?: string | null;
  items?: SalesOrderItem[];
  /** 详情接口额外返回的下游单据（只读） */
  productionOrders?: { id: string; productionNo: string; status: string }[];
  shipments?: { id: string; shipmentNo: string; status: string }[];
  payments?: {
    id: string;
    paymentNo: string;
    direction: string;
    type: string;
    amount: string;
    currency: string;
    status: string;
  }[];
  profit?: { id: string; profitNo: string; profitCny: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderListRes {
  list: SalesOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SalesOrderItemInput {
  productId?: string | null;
  productName?: string;
  productSku?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  material?: string | null;
  packaging?: string | null;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  costPrice?: number | null;
  deliveryDate?: string | null;
  remark?: string | null;
  sort?: number;
}

/** 创建 / 更新入参。totalAmount 留空时后端按 items 汇总 */
export interface SalesOrderPayload {
  opportunityId: string;
  customerId?: string | null;
  quotationId?: string | null;
  sampleOrderId?: string | null;
  currency?: string;
  totalAmount?: number;
  depositRatio?: number | null;
  depositAmount?: number | null;
  status?: SalesOrderStatus;
  orderDate?: string | null;
  deliveryDate?: string | null;
  tradeTerms?: string | null;
  paymentTerms?: string | null;
  portOfLoading?: string | null;
  portOfDischarge?: string | null;
  remark?: string | null;
  items?: SalesOrderItemInput[];
}

export const salesOrderApi = {
  list: (params?: {
    customerId?: string;
    opportunityId?: string;
    quotationId?: string;
    sampleOrderId?: string;
    status?: SalesOrderStatus;
    /** 按产品过滤（命中 SalesOrderItem.productId）；后端 additive 支持 */
    productId?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) => request.get<ApiResponse<SalesOrderListRes>>('/sales-orders', { params }),

  get: (id: string) => request.get<ApiResponse<SalesOrder>>(`/sales-orders/${id}`),

  create: (data: SalesOrderPayload) =>
    request.post<ApiResponse<SalesOrder>>('/sales-orders', data),

  update: (id: string, data: Partial<SalesOrderPayload>) =>
    request.put<ApiResponse<SalesOrder>>(`/sales-orders/${id}`, data),

  remove: (id: string) => request.delete<ApiResponse<null>>(`/sales-orders/${id}`),
};
