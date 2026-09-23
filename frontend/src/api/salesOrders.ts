import type { ApiResponse } from './request';
import request from './request';
import { unwrapPage, unwrapResponse } from '../utils/response';
import type { PageResult } from '../types/masterData';
import type {
  SalesOrderCreatePayload,
  SalesOrderDetail,
  SalesOrderListItem,
  SalesOrderListQuery,
  SalesOrderUpdatePayload,
} from '../types/salesOrder';

/**
 * SalesOrder（销售订单）API（Round F-S4）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/salesOrder.routes.ts）：
 *   GET  /api/sales-orders        → 分页列表 { list, total, page, pageSize }
 *   GET  /api/sales-orders/:id    → 详情（+ productionOrders/shipments/payments/profit 只读投影）
 *   POST /api/sales-orders        → 创建（opportunityId 必填；customerId 由商机推导）
 *   PUT  /api/sales-orders/:id    → 更新（partial；传 items 会**整表重建**明细）
 *
 * **不封装** DELETE（D-FS4-023：MVP 不开放删除）。
 * 权限：仅 `authenticate`（无 requirePerm）；scope = 后端 `roleScope({ field:'ownerId' })`，前端不做过滤。
 */

const toParams = <Q extends object>(query?: Q): Record<string, string | number> => {
  const params: Record<string, string | number> = {};
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }
  return params;
};

export const salesOrderApi = {
  list: (params?: SalesOrderListQuery) =>
    request.get<ApiResponse<PageResult<SalesOrderListItem>>>('/sales-orders', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<SalesOrderDetail>>(`/sales-orders/${encodeURIComponent(id)}`),
  create: (payload: SalesOrderCreatePayload) => request.post<ApiResponse<SalesOrderListItem>>('/sales-orders', payload),
  update: (id: string, payload: SalesOrderUpdatePayload) =>
    request.put<ApiResponse<SalesOrderListItem>>(`/sales-orders/${encodeURIComponent(id)}`, payload),
};

/** 订单分页列表（形状校验：list/total/page/pageSize） */
export const getSalesOrders = async (params?: SalesOrderListQuery): Promise<PageResult<SalesOrderListItem>> =>
  unwrapPage<SalesOrderListItem>(await salesOrderApi.list(params), 'GET /sales-orders');

/** 订单详情（不存在 / 越权 → 404「销售订单不存在」） */
export const getSalesOrder = async (id: string): Promise<SalesOrderDetail> =>
  unwrapResponse(await salesOrderApi.detail(id), 'GET /sales-orders/:id').data;

/** 创建订单（POST /api/sales-orders） */
export const createSalesOrder = async (payload: SalesOrderCreatePayload): Promise<SalesOrderListItem> =>
  unwrapResponse(await salesOrderApi.create(payload), 'POST /sales-orders').data;

/** 更新订单（PUT /api/sales-orders/:id；未传字段后端保持原值） */
export const updateSalesOrder = async (id: string, payload: SalesOrderUpdatePayload): Promise<SalesOrderListItem> =>
  unwrapResponse(await salesOrderApi.update(id, payload), 'PUT /sales-orders/:id').data;

/**
 * F-S6：将订单置为「已完成」—— 复用后端既有 `PUT /api/sales-orders/:id`（status 可直接写，
 * 无独立 completion 端点，亦无状态流转校验），成功后后端自动写 `completedAt`。
 *
 * ★ 仅由订单详情页的「标记完成」动作调用；F-S4 的编辑表单不提交 status（状态在表单中只读）。
 */
export const completeSalesOrder = async (id: string): Promise<SalesOrderListItem> =>
  unwrapResponse(
    await request.put<ApiResponse<SalesOrderListItem>>(`/sales-orders/${encodeURIComponent(id)}`, {
      status: 'COMPLETED',
    }),
    'PUT /sales-orders/:id (COMPLETED)',
  ).data;
