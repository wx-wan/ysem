import request from './request';
import type { ApiResponse } from './request';

// ========== 类型定义 ==========
export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  remark?: string;
  createdAt: string;
}

export interface PurchaseItem {
  productId?: string;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  remark?: string;
}

export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'ARRIVED' | 'CANCELLED';

export interface PurchaseOrder {
  id: string;
  purchaseNo?: string;
  supplierId?: string;
  supplier?: Supplier | null;
  purchaseDate?: string;
  status: PurchaseStatus;
  items?: string; // JSON
  amountCNY?: number;
  remark?: string;
  ownerId?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseStats {
  total: number;
  pending: number;
  amountCNY: number;
}

// ========== 接口 ==========
export const purchaseApi = {
  // 采购单
  list: (params: Record<string, unknown>) =>
    request.get<ApiResponse<{ items: PurchaseOrder[]; total: number; stats: PurchaseStats }>>('/purchases', { params }),
  detail: (id: string) => request.get<ApiResponse<{ item: PurchaseOrder }>>(`/purchases/${id}`),
  create: (data: Partial<PurchaseOrder> & { items: PurchaseItem[] }) =>
    request.post<ApiResponse<{ item: PurchaseOrder }>>('/purchases', data),
  update: (id: string, data: Partial<PurchaseOrder> & { items: PurchaseItem[] }) =>
    request.put<ApiResponse<{ item: PurchaseOrder }>>(`/purchases/${id}`, data),
  changeStatus: (id: string, status: PurchaseStatus) =>
    request.patch<ApiResponse<{ item: PurchaseOrder }>>(`/purchases/${id}/status`, { status }),
  remove: (id: string) => request.delete<ApiResponse<{ deleted: boolean }>>(`/purchases/${id}`),

  // 供应商
  listSuppliers: (params?: Record<string, unknown>) =>
    request.get<ApiResponse<{ items: Supplier[] }>>('/purchases/suppliers', { params }),
  createSupplier: (data: Partial<Supplier>) =>
    request.post<ApiResponse<{ item: Supplier }>>('/purchases/suppliers', data),
};

// 状态文案与颜色（与页面共用）
export const PURCHASE_STATUS_TEXT: Record<PurchaseStatus, string> = {
  DRAFT: '草稿',
  ORDERED: '已下单',
  PARTIAL: '部分到货',
  ARRIVED: '已到货',
  CANCELLED: '已取消',
};

export const PURCHASE_STATUS_COLOR: Record<PurchaseStatus, string> = {
  DRAFT: 'default',
  ORDERED: 'processing',
  PARTIAL: 'warning',
  ARRIVED: 'success',
  CANCELLED: 'error',
};
