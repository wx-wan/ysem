import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 收付款（Payment）==========
// 后端：/api/payments（V1.0 controller），编号 PAY → PY-yyyyMMdd-0001（NumberSequence 生成）。
//
// 宿主语义（exactly-one，DB 侧 payment_exactly_one_owner_ck + 应用层双重校验）：
//   direction = IN  → 收款，宿主 salesOrderId，且 customerId 强制取 SalesOrder.customerId
//   direction = OUT → 付款，宿主 purchaseOrderId，且 customerId 必须为 NULL
//
// 注意：Decimal 字段（exchangeRate / amount / amountCny / ratio）经 JSON 序列化为「字符串」，
// 可空字段（amountCny / ratio / exchangeRate）允许为 null —— 前端不得用 ?? 0 掩盖缺失汇率。

export type PaymentDirection = 'IN' | 'OUT';
export type PaymentType = 'DEPOSIT' | 'BALANCE' | 'FULL' | 'OTHER';
export type PaymentStatus = 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'FAILED';

export const PAYMENT_DIRECTION_TEXT: Record<PaymentDirection, string> = {
  IN: '收款',
  OUT: '付款',
};

export const PAYMENT_DIRECTION_COLOR: Record<PaymentDirection, string> = {
  IN: 'green',
  OUT: 'orange',
};

export const PAYMENT_TYPE_TEXT: Record<PaymentType, string> = {
  DEPOSIT: '定金',
  BALANCE: '尾款',
  FULL: '全款',
  OTHER: '其他',
};

export const PAYMENT_STATUS_TEXT: Record<PaymentStatus, string> = {
  PENDING: '待确认',
  RECEIVED: '已收到',
  CONFIRMED: '已确认',
  FAILED: '失败',
};

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  PENDING: 'default',
  RECEIVED: 'processing',
  CONFIRMED: 'success',
  FAILED: 'error',
};

/** 收付款单（宿主 exactly-one；无 ownerId，数据范围经宿主继承） */
export interface Payment {
  id: string;
  paymentNo: string;
  direction: PaymentDirection;
  type: PaymentType;

  /** 宿主：IN 时必填，OUT 时必须为 null */
  salesOrderId: string | null;
  /** 宿主：OUT 时必填，IN 时必须为 null */
  purchaseOrderId: string | null;
  /** 辅助字段（非宿主）：仅 IN 有值；OUT 必须为 null */
  customerId: string | null;

  currency: string;
  /** Decimal(18,8)，可空（缺汇率） */
  exchangeRate: string | null;
  /** 原币金额 */
  amount: string;
  /** 本位币金额（可空，禁止用 0 掩盖） */
  amountCny: string | null;
  /** 收付款比例 %（可空） */
  ratio: string | null;

  payDate: string | null;
  method: string | null;
  bankAccount: string | null;
  voucherRemark: string | null;

  status: PaymentStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;

  remark: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- include ----
  salesOrder?: { id: string; orderNo: string; status: string; ownerId: string | null } | null;
  purchaseOrder?: { id: string; purchaseNo: string; status: string; ownerId: string | null } | null;
  customer?: { id: string; customerNo: string; companyName: string } | null;
}

export interface PaymentListRes {
  list: Payment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaymentListParams {
  direction?: PaymentDirection;
  type?: PaymentType;
  status?: PaymentStatus;
  salesOrderId?: string;
  purchaseOrderId?: string;
  customerId?: string;
  keyword?: string;
  page?: number;
  pageSize?: number;
}

/** 创建 / 更新入参（方向与宿主必须自洽，否则后端 400） */
export interface PaymentPayload {
  direction: PaymentDirection;
  type?: PaymentType;
  salesOrderId?: string | null;
  purchaseOrderId?: string | null;
  customerId?: string | null;
  currency?: string;
  exchangeRate?: number | string | null;
  amount: number | string;
  ratio?: number | string | null;
  payDate?: string | null;
  method?: string | null;
  bankAccount?: string | null;
  voucherRemark?: string | null;
  status?: PaymentStatus;
  remark?: string | null;
}

export const paymentApi = {
  list: (params?: PaymentListParams) =>
    request.get<ApiResponse<PaymentListRes>>('/payments', { params }),

  get: (id: string) => request.get<ApiResponse<Payment>>(`/payments/${id}`),

  create: (data: PaymentPayload) =>
    request.post<ApiResponse<Payment>>('/payments', data),

  update: (id: string, data: Partial<PaymentPayload>) =>
    request.put<ApiResponse<Payment>>(`/payments/${id}`, data),

  remove: (id: string) => request.delete<ApiResponse<null>>(`/payments/${id}`),
};
