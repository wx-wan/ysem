import type { ApiResponse } from './request';
import request from './request';
import { unwrapPage, unwrapResponse } from '../utils/response';
import type { PageResult } from '../types/masterData';
import type { ShipmentCreatePayload, ShipmentDetail, ShipmentListItem, ShipmentListQuery } from '../types/shipment';

/**
 * Shipment（出运单）API（Round F-S5）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/shipment.routes.ts）：
 *   GET  /api/shipments        → 分页列表（scope 经 `salesOrder.ownerId`）
 *   GET  /api/shipments/:id    → 详情（+ inspections 只读投影；404「出运单不存在」）
 *   POST /api/shipments        → 创建（salesOrderId 必填；状态门限 + 数量上限 + shippedQty 重算）
 *
 * **不封装**：PUT / DELETE（F-S5 仅 List/Create/Detail —— 不设计出运状态流转）。
 * 权限：仅 `authenticate`（无 requirePerm）。
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

export const shipmentApi = {
  list: (params?: ShipmentListQuery) =>
    request.get<ApiResponse<PageResult<ShipmentListItem>>>('/shipments', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<ShipmentDetail>>(`/shipments/${encodeURIComponent(id)}`),
  create: (payload: ShipmentCreatePayload) => request.post<ApiResponse<ShipmentListItem>>('/shipments', payload),
};

/** 出运单分页列表 */
export const getShipments = async (params?: ShipmentListQuery): Promise<PageResult<ShipmentListItem>> =>
  unwrapPage<ShipmentListItem>(await shipmentApi.list(params), 'GET /shipments');

/** 出运单详情 */
export const getShipment = async (id: string): Promise<ShipmentDetail> =>
  unwrapResponse(await shipmentApi.detail(id), 'GET /shipments/:id').data;

/** 创建出运单（POST /api/shipments） */
export const createShipment = async (payload: ShipmentCreatePayload): Promise<ShipmentListItem> =>
  unwrapResponse(await shipmentApi.create(payload), 'POST /shipments').data;
