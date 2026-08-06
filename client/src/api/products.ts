import request from './request';
import type { ApiResponse } from './request';

// ========== 类型 ==========
export type ProductType = 'SELF' | 'EXTERNAL'; // 自产品 / 外购品
export type SelfKind = 'FINISHED' | 'SEMI';     // 成品 / 半成品
export type ProductSource = 'MANUAL' | 'SYNC' | 'RPA';
export type ProductStatus = 'ACTIVE' | 'INACTIVE';

export interface Product {
  id: string;
  name: string;
  sku?: string | null;
  type: ProductType;
  selfKind?: SelfKind | null;
  category?: string | null;
  unit?: string | null;
  spec?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  taxRate?: number | null;
  stock?: number | null;
  lowStockAlert?: number | null;
  source: ProductSource;
  status: ProductStatus;
  remark?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
  source?: string;
  status?: string;
}

export interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  type: ProductType;
  selfKind?: SelfKind | null;
  unit?: string | null;
  price?: number | null;
}

export interface ProductPayload {
  name: string;
  sku?: string | null;
  type?: ProductType;
  selfKind?: SelfKind | null;
  category?: string | null;
  unit?: string | null;
  spec?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  taxRate?: number | null;
  stock?: number | null;
  lowStockAlert?: number | null;
  source?: ProductSource;
  status?: ProductStatus;
  remark?: string | null;
}

export interface LeadProductItem {
  productId: string;
  quantity?: number;
}

export interface ImportResult {
  total: number;
  success: number;
  errors: string[];
}

// ========== API ==========
export const productApi = {
  list: (params: ProductQuery) =>
    request.get<ApiResponse<{ list: Product[]; total: number; page: number; pageSize: number }>>('/products', { params }),

  get: (id: string) =>
    request.get<ApiResponse<Product>>(`/products/${id}`),

  create: (data: ProductPayload) =>
    request.post<ApiResponse<Product>>('/products', data),

  update: (id: string, data: Partial<ProductPayload>) =>
    request.put<ApiResponse<Product>>(`/products/${id}`, data),

  remove: (id: string) =>
    request.delete<ApiResponse<null>>(`/products/${id}`),

  batchRemove: (ids: string[]) =>
    request.delete<ApiResponse<null>>('/products/batch', { data: { ids } }),

  import: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request.post<ApiResponse<ImportResult>>('/products/import', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  importByRpa: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request.post<ApiResponse<ImportResult>>('/products/import/rpa', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  syncPlatform: () =>
    request.get<ApiResponse<{ synced: number; message: string }>>('/products/sync'),

  options: () =>
    request.get<ApiResponse<ProductOption[]>>('/products/options'),
};

// ========== 标签文案 ==========
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  SELF: '自产品',
  EXTERNAL: '外购品',
};

export const SELF_KIND_LABELS: Record<SelfKind, string> = {
  FINISHED: '成品',
  SEMI: '半成品',
};

export const PRODUCT_SOURCE_LABELS: Record<ProductSource, string> = {
  MANUAL: '手动录入',
  SYNC: '平台同步',
  RPA: 'RPA导入',
};

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  ACTIVE: '启用',
  INACTIVE: '停用',
};
