import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 报价（Quotation）==========
// 后端：/api/quotations（V1.0 controller），编号 QUO → QU-yyyyMMdd-0001（NumberSequence 生成）。
// 注意：金额 / 数量列在数据库为 Decimal，经 JSON 序列化后到达前端为「字符串」，展示时需 Number() 归一。

export type QuotationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED';

export const QUOTATION_STATUS_TEXT: Record<QuotationStatus, string> = {
  DRAFT: '草稿',
  SUBMITTED: '待审批',
  SENT: '已发送',
  ACCEPTED: '客户接受',
  REJECTED: '客户拒绝',
  EXPIRED: '已过期',
};

export const QUOTATION_STATUS_COLOR: Record<QuotationStatus, string> = {
  DRAFT: 'default',
  SUBMITTED: 'processing',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
  EXPIRED: 'warning',
};

/** 报价明细（快照字段，ADR-04） */
export interface QuotationItem {
  id: string;
  quotationId: string;
  productId?: string | null;
  product?: { id: string; name: string; sku?: string | null } | null;
  productName: string;
  productSku?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  amount: string;
  currency: string;
  costPrice?: string | null;
  leadTime?: number | null;
  remark?: string | null;
  sort: number;
}

/** 报价单 */
export interface Quotation {
  id: string;
  quotationNo: string;
  opportunityId: string;
  opportunity?: { id: string; opportunityNo: string; title: string } | null;
  customerId: string;
  customer?: { id: string; customerNo: string; companyName: string } | null;
  /** 同一商机下的报价版本号 */
  version: number;
  parentId?: string | null;
  title: string;
  currency: string;
  exchangeRate?: string | null;
  totalAmount: string;
  totalAmountCny?: string | null;
  tradeTerms?: string | null;
  paymentTerms?: string | null;
  leadTime?: number | null;
  validUntil?: string | null;
  portOfLoading?: string | null;
  status: QuotationStatus;
  submittedAt?: string | null;
  sentAt?: string | null;
  acceptedAt?: string | null;
  rejectedAt?: string | null;
  rejectReason?: string | null;
  notes?: string | null;
  ownerId?: string | null;
  items?: QuotationItem[];
  createdAt: string;
  updatedAt: string;
}

export interface QuotationListRes {
  list: Quotation[];
  total: number;
  page: number;
  pageSize: number;
}

/** 明细入参：后端以「整表重建（deleteMany + create）」语义处理 */
export interface QuotationItemInput {
  productId?: string | null;
  productName?: string;
  productSku?: string | null;
  spec?: string | null;
  craft?: string | null;
  size?: string | null;
  packaging?: string | null;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  costPrice?: number | null;
  leadTime?: number | null;
  remark?: string | null;
  sort?: number;
}

/** 创建 / 更新入参。totalAmount 留空时后端按 items 汇总 */
export interface QuotationPayload {
  opportunityId: string;
  customerId?: string | null;
  title: string;
  currency?: string;
  validUntil?: string | null;
  status?: QuotationStatus;
  tradeTerms?: string | null;
  paymentTerms?: string | null;
  leadTime?: number | null;
  portOfLoading?: string | null;
  notes?: string | null;
  totalAmount?: number;
  items?: QuotationItemInput[];
}

export const quotationApi = {
  list: (params?: {
    opportunityId?: string;
    customerId?: string;
    status?: QuotationStatus;
    /** 按产品过滤（命中 QuotationItem.productId）；后端 additive 支持 */
    productId?: string;
    page?: number;
    pageSize?: number;
  }) => request.get<ApiResponse<QuotationListRes>>('/quotations', { params }),

  get: (id: string) => request.get<ApiResponse<Quotation>>(`/quotations/${id}`),

  create: (data: QuotationPayload) =>
    request.post<ApiResponse<Quotation>>('/quotations', data),

  update: (id: string, data: Partial<QuotationPayload>) =>
    request.put<ApiResponse<Quotation>>(`/quotations/${id}`, data),

  remove: (id: string) => request.delete<ApiResponse<null>>(`/quotations/${id}`),
};
