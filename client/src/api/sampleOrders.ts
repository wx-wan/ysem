import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 打样单（SampleOrder）==========
// 后端：/api/sample-orders（V1.0 controller），编号 SMP → SM-yyyyMMdd-0001（NumberSequence 生成）。
// 注意：feeAmount 在数据库为 Decimal，经 JSON 序列化后到达前端为「字符串」。

export type SampleStatus =
  | 'DRAFT'
  | 'DESIGNING'
  | 'MOLDING'
  | 'SAMPLE_SENT'
  | 'FEEDBACK'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export const SAMPLE_STATUS_TEXT: Record<SampleStatus, string> = {
  DRAFT: '草稿',
  DESIGNING: '设计中',
  MOLDING: '开模中',
  SAMPLE_SENT: '已寄样',
  FEEDBACK: '客户反馈中',
  APPROVED: '客户确认',
  REJECTED: '客户否决',
  CANCELLED: '已取消',
};

export const SAMPLE_STATUS_COLOR: Record<SampleStatus, string> = {
  DRAFT: 'default',
  DESIGNING: 'geekblue',
  MOLDING: 'purple',
  SAMPLE_SENT: 'gold',
  FEEDBACK: 'processing',
  APPROVED: 'green',
  REJECTED: 'red',
  CANCELLED: 'default',
};

export type SampleRoundResult = 'PENDING' | 'PASSED' | 'FAILED';

export const SAMPLE_ROUND_RESULT_TEXT: Record<SampleRoundResult, string> = {
  PENDING: '待定',
  PASSED: '通过',
  FAILED: '未通过',
};

/** 打样轮次（SampleOrder 1:N SampleRound） */
export interface SampleRound {
  id: string;
  sampleOrderId: string;
  roundNo: number;
  designAt?: string | null;
  moldAt?: string | null;
  sentAt?: string | null;
  feedbackAt?: string | null;
  trackingNo?: string | null;
  feeAmount?: string | null;
  result: SampleRoundResult;
  feedback?: string | null;
  improvements?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 打样单 */
export interface SampleOrder {
  id: string;
  sampleNo: string;
  opportunityId?: string | null;
  opportunity?: { id: string; opportunityNo: string; title: string } | null;
  customerId: string;
  customer?: { id: string; customerNo: string; companyName: string } | null;
  productId?: string | null;
  product?: { id: string; name: string; sku?: string | null } | null;
  /** 产品快照（ADR-04） */
  productName: string;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
  sampleType?: string | null;
  quantity: number;
  requirement?: string | null;
  targetPrice?: string | null;
  status: SampleStatus;
  currentRound: number;
  rounds?: SampleRound[];
  /** 详情接口额外返回：来源打样产生的下游销售订单（SampleOrder 1:N SalesOrder） */
  salesOrders?: { id: string; orderNo: string; status: string }[];
  feeAmount?: string | null;
  feeCurrency: string;
  feeRecoverable: boolean;
  ownerId?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SampleOrderListRes {
  list: SampleOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SampleOrderPayload {
  opportunityId?: string | null;
  customerId?: string | null;
  productId?: string | null;
  productName?: string;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
  sampleType?: string | null;
  quantity?: number;
  requirement?: string | null;
  targetPrice?: string | null;
  status?: SampleStatus;
  feeAmount?: number;
  feeCurrency?: string;
  feeRecoverable?: boolean;
  ownerId?: string | null;
  notes?: string | null;
}

export interface SampleRoundPayload {
  designAt?: string | null;
  moldAt?: string | null;
  sentAt?: string | null;
  feedbackAt?: string | null;
  trackingNo?: string | null;
  feeAmount?: number | null;
  result?: SampleRoundResult;
  feedback?: string | null;
  improvements?: string | null;
}

export const sampleOrderApi = {
  list: (params?: {
    opportunityId?: string;
    customerId?: string;
    status?: SampleStatus;
    /** 按产品过滤（命中 SampleOrder.productId）；后端 additive 支持 */
    productId?: string;
    keyword?: string;
    page?: number;
    pageSize?: number;
  }) => request.get<ApiResponse<SampleOrderListRes>>('/sample-orders', { params }),

  get: (id: string) => request.get<ApiResponse<SampleOrder>>(`/sample-orders/${id}`),

  create: (data: SampleOrderPayload) =>
    request.post<ApiResponse<SampleOrder>>('/sample-orders', data),

  update: (id: string, data: Partial<SampleOrderPayload>) =>
    request.put<ApiResponse<SampleOrder>>(`/sample-orders/${id}`, data),

  remove: (id: string) => request.delete<ApiResponse<null>>(`/sample-orders/${id}`),

  // ---- 打样轮次 ----
  listRounds: (id: string) =>
    request.get<ApiResponse<SampleRound[]>>(`/sample-orders/${id}/rounds`),

  createRound: (id: string, data: SampleRoundPayload) =>
    request.post<ApiResponse<SampleRound>>(`/sample-orders/${id}/rounds`, data),

  updateRound: (id: string, roundId: string, data: Partial<SampleRoundPayload>) =>
    request.put<ApiResponse<SampleRound>>(`/sample-orders/${id}/rounds/${roundId}`, data),

  removeRound: (id: string, roundId: string) =>
    request.delete<ApiResponse<null>>(`/sample-orders/${id}/rounds/${roundId}`),
};
