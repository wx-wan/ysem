import request from './request';
import type { ApiResponse } from './request';

// ========== V1.0 采购单（PurchaseOrder）==========
// 后端：/api/purchase-orders（V1.0 controller），编号 PR-yyyyMMdd-0001（NumberSequence 生成）。
//
// 语义要点：
//  - 明细为独立实体 `PurchaseOrderItem[]`（**不是 JSON 字符串**）；
//  - 金额三件套 `currency / exchangeRate / totalAmount / totalAmountCny` 全部为 Decimal，
//    经 JSON 序列化后到达前端为「字符串」；可空字段允许 null；
//  - 金额由**服务端权威计算**：amount = quantity × unitPrice；totalAmount = Σ amount；
//    totalAmountCny 由 rateToCny 折算（缺汇率 → null）。前端**不得**提交任何金额字段；
//  - `purchaseType` 为成本归集维度（决定计入 Profit 的成本科目）；
//  - 供应商仍走 legacy 端点 `/api/purchases/suppliers`（无 V1.0 supplier 模块，且其 createSupplier 已为 V1.0 语义）。

export type PurchaseStatus = 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'ARRIVED' | 'CANCELLED';
export type PurchaseType = 'MATERIAL' | 'OUTSOURCE' | 'PACKAGING';
export type PurchaseItemStatus = 'PENDING' | 'PARTIAL' | 'ARRIVED';

// 状态文案与颜色（与 V1.0 PurchaseStatus 五值一致）
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

export const PURCHASE_TYPE_TEXT: Record<PurchaseType, string> = {
  MATERIAL: '材料采购',
  OUTSOURCE: '外协采购',
  PACKAGING: '包装采购',
};

export const PURCHASE_ITEM_STATUS_TEXT: Record<PurchaseItemStatus, string> = {
  PENDING: '待货',
  PARTIAL: '部分到货',
  ARRIVED: '已到货',
};

/** 采购明细（快照字段 + 行级到货状态） */
export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  lineNo: number;
  productId?: string | null;
  /** 成本归集链：对应哪条生产明细（ProductionOrderItem） */
  productionOrderItemId?: string | null;
  /** 无产品主数据时（原辅料）直接记录名称 */
  itemName: string;
  spec?: string | null;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** = quantity × unitPrice（服务端权威） */
  amount: string;
  currency: string;
  /** 已到货数量（由到货流程回写；本轮只读） */
  arrivedQty: string;
  status: PurchaseItemStatus;
  remark?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PurchaseOrder {
  id: string;
  purchaseNo: string;

  salesOrderId?: string | null;
  productionOrderId?: string | null;
  supplierId?: string | null;

  purchaseDate?: string | null;
  status: PurchaseStatus;
  expectedArrivalAt?: string | null;
  arrivedAt?: string | null;

  currency: string;
  exchangeRate?: string | null;
  totalAmount?: string | null;
  totalAmountCny?: string | null;

  purchaseType: PurchaseType;
  ownerId?: string | null;
  remark?: string | null;

  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;

  // ---- include ----
  supplier?: {
    id: string;
    supplierNo?: string | null;
    name: string;
    contact?: string | null;
    phone?: string | null;
  } | null;
  salesOrder?: { id: string; orderNo: string; status: string } | null;
  productionOrder?: { id: string; productionNo: string; status: string } | null;
  items?: PurchaseOrderItem[];
}

export interface PurchaseOrderListRes {
  list: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PurchaseOrderListParams {
  keyword?: string;
  status?: PurchaseStatus;
  supplierId?: string;
  salesOrderId?: string;
  productionOrderId?: string;
  purchaseType?: PurchaseType;
  page?: number;
  pageSize?: number;
}

/** 明细入参：**不接受 amount**（服务端按 quantity × unitPrice 权威计算） */
export interface PurchaseOrderItemInput {
  productId?: string | null;
  productionOrderItemId?: string | null;
  itemName: string;
  spec?: string | null;
  quantity: number | string;
  unit?: string;
  unitPrice: number | string;
  currency?: string | null;
  arrivedQty?: number | string;
  status?: PurchaseItemStatus;
  remark?: string | null;
}

/** 创建 / 更新入参：金额字段一律不提交（服务端权威） */
export interface PurchaseOrderPayload {
  salesOrderId?: string | null;
  productionOrderId?: string | null;
  supplierId?: string | null;
  purchaseDate?: string | null;
  status?: PurchaseStatus;
  expectedArrivalAt?: string | null;
  arrivedAt?: string | null;
  currency?: string;
  exchangeRate?: number | string | null;
  purchaseType?: PurchaseType;
  ownerId?: string | null;
  remark?: string | null;
  items?: PurchaseOrderItemInput[];
}

/** 供应商（仍由 legacy `/api/purchases/suppliers` 提供） */
export interface Supplier {
  id: string;
  supplierNo?: string | null;
  name: string;
  contact?: string | null;
  phone?: string | null;
  address?: string | null;
  remark?: string | null;
  createdAt?: string;
}

export const purchaseApi = {
  // ---- V1.0 采购单 ----
  list: (params?: PurchaseOrderListParams) =>
    request.get<ApiResponse<PurchaseOrderListRes>>('/purchase-orders', { params }),

  get: (id: string) => request.get<ApiResponse<PurchaseOrder>>(`/purchase-orders/${id}`),

  create: (data: PurchaseOrderPayload) =>
    request.post<ApiResponse<PurchaseOrder>>('/purchase-orders', data),

  update: (id: string, data: Partial<PurchaseOrderPayload>) =>
    request.put<ApiResponse<PurchaseOrder>>(`/purchase-orders/${id}`, data),

  remove: (id: string) => request.delete<ApiResponse<null>>(`/purchase-orders/${id}`),

  // ---- 供应商（保留 legacy 端点；无 V1.0 supplier 模块）----
  listSuppliers: (params?: { keyword?: string }) =>
    request.get<ApiResponse<{ items: Supplier[] }>>('/purchases/suppliers', { params }),

  createSupplier: (data: { name: string; contact?: string; phone?: string; address?: string; remark?: string }) =>
    request.post<ApiResponse<{ item: Supplier }>>('/purchases/suppliers', data),
};
