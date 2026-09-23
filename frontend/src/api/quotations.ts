import type { ApiResponse } from './request';
import request from './request';
import { unwrapPage, unwrapResponse } from '../utils/response';
import type { PageResult } from '../types/masterData';
import type {
  QuotationCreatePayload,
  QuotationDetail,
  QuotationListItem,
  QuotationListQuery,
  QuotationUpdatePayload,
} from '../types/quotation';

/**
 * Quotation（报价）API（Round F-S3）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/quotation.routes.ts）：
 *   GET  /api/quotations        → 分页列表 { list, total, page, pageSize }
 *   GET  /api/quotations/:id    → 详情（customer + opportunity + items；404「报价不存在」）
 *   POST /api/quotations        → 创建（标题 + 商机必填；客户/金额/汇率/状态由后端推导）
 *   PUT  /api/quotations/:id    → 更新（partial；传 items 会整表重建明细）
 *
 * **不封装**：DELETE /:id（F-S3 不做删除）。
 *
 * 权限：quotation 路由仅 `authenticate`（**无 requirePerm**）；数据范围由后端
 * `roleScope({ field: 'ownerId' })` 收敛（ALL / DEPT / SELF，**无公海语义**）——
 * 前端不做任何范围过滤或放宽。
 */

/** 去掉 undefined / null / 空字符串，避免 ?status=undefined 之类脏参数 */
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
export const quotationApi = {
  list: (params?: QuotationListQuery) =>
    request.get<ApiResponse<PageResult<QuotationListItem>>>('/quotations', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<QuotationDetail>>(`/quotations/${encodeURIComponent(id)}`),
  create: (payload: QuotationCreatePayload) => request.post<ApiResponse<QuotationListItem>>('/quotations', payload),
  update: (id: string, payload: QuotationUpdatePayload) =>
    request.put<ApiResponse<QuotationListItem>>(`/quotations/${encodeURIComponent(id)}`, payload),
};

/** 报价分页列表（形状校验：list/total/page/pageSize） */
export const getQuotations = async (params?: QuotationListQuery): Promise<PageResult<QuotationListItem>> =>
  unwrapPage<QuotationListItem>(await quotationApi.list(params), 'GET /quotations');

/** 报价详情（不存在 / 越权 → 后端 404「报价不存在」，错误向上抛，不吞成 null） */
export const getQuotation = async (id: string): Promise<QuotationDetail> =>
  unwrapResponse(await quotationApi.detail(id), 'GET /quotations/:id').data;

/** 创建报价（POST /api/quotations） */
export const createQuotation = async (payload: QuotationCreatePayload): Promise<QuotationListItem> =>
  unwrapResponse(await quotationApi.create(payload), 'POST /quotations').data;

/** 更新报价（PUT /api/quotations/:id；未传字段后端保持原值） */
export const updateQuotation = async (id: string, payload: QuotationUpdatePayload): Promise<QuotationListItem> =>
  unwrapResponse(await quotationApi.update(id, payload), 'PUT /quotations/:id').data;
