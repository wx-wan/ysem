import type { ApiResponse } from './request';
import request from './request';
import { unwrapPage, unwrapResponse } from '../utils/response';
import type { PageResult } from '../types/masterData';
import type {
  OpportunityCreatePayload,
  OpportunityDetail,
  OpportunityListItem,
  OpportunityListQuery,
  OpportunityUpdatePayload,
} from '../types/sales';

/**
 * Sales（商机 / Opportunity）API（Round F-S2）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/sales.routes.ts）：
 *   GET  /api/sales        → 分页列表 { list, total, page, pageSize }（行含 include + 派生 stage）
 *   GET  /api/sales/:id    → 详情（+ activities ≤30 + 派生 stage）；scope 外与不存在同为 404「记录不存在」
 *   POST /api/sales        → 创建（customerId / title 必填；SKU 无关；编号后端生成）
 *   PUT  /api/sales/:id    → 更新（partial；传 products 会重建明细）
 *
 * **不封装**（不在 F-S2 范围）：DELETE /:id · DELETE /batch · /kanban · /import · /assign-users
 * · /by-customer/:customerId · /by-product/:productId（后两者为本项目既有能力，本阶段不消费）。
 *
 * 权限：sales 路由仅 `authenticate`（无 requirePerm）；数据范围由后端 `roleScope({ field: 'ownerId' })`
 * 收敛 —— 前端**不做**任何范围过滤或放宽。
 */

/** 去掉 undefined / null / 空字符串，避免 ?keyword=undefined 之类脏参数 */
const toParams = <Q extends object>(query?: Q): Record<string, string | number> => {
  const params: Record<string, string | number> = {};
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number') params[key] = value;
  }
  return params;
};

/** 原始请求（保留信封，便于需要 code/message 的场景） */
export const salesApi = {
  list: (params?: OpportunityListQuery) =>
    request.get<ApiResponse<PageResult<OpportunityListItem>>>('/sales', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<OpportunityDetail>>(`/sales/${encodeURIComponent(id)}`),
  create: (payload: OpportunityCreatePayload) => request.post<ApiResponse<OpportunityListItem>>('/sales', payload),
  update: (id: string, payload: OpportunityUpdatePayload) =>
    request.put<ApiResponse<OpportunityListItem>>(`/sales/${encodeURIComponent(id)}`, payload),
};

/** 商机分页列表（形状校验：list/total/page/pageSize） */
export const getOpportunities = async (params?: OpportunityListQuery): Promise<PageResult<OpportunityListItem>> =>
  unwrapPage<OpportunityListItem>(await salesApi.list(params), 'GET /sales');

/** 商机详情（不存在 / 越权 → 后端 404，错误向上抛，不吞成 null） */
export const getOpportunity = async (id: string): Promise<OpportunityDetail> =>
  unwrapResponse(await salesApi.detail(id), 'GET /sales/:id').data;

/** 创建商机（POST /api/sales） */
export const createOpportunity = async (payload: OpportunityCreatePayload): Promise<OpportunityListItem> =>
  unwrapResponse(await salesApi.create(payload), 'POST /sales').data;

/** 更新商机（PUT /api/sales/:id；未传字段后端保持原值） */
export const updateOpportunity = async (
  id: string,
  payload: OpportunityUpdatePayload,
): Promise<OpportunityListItem> =>
  unwrapResponse(await salesApi.update(id, payload), 'PUT /sales/:id').data;
