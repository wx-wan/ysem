import type { ApiResponse } from './request';
import request from './request';
import { unwrapPage, unwrapResponse } from '../utils/response';
import type { PageResult } from '../types/masterData';
import type {
  ProductCreatePayload,
  ProductDetail,
  ProductListItem,
  ProductListQuery,
  ProductMutated,
  ProductUpdatePayload,
} from '../types/product';

/**
 * Product API（Round F-S1）
 *
 * 只封装后端**当前真实存在**的端点（server/src/routes/product.routes.ts）：
 *   GET  /api/products          → 分页列表 { list, total, page, pageSize }
 *   GET  /api/products/:id      → 详情（404 产品不存在 / 403 无权查看不公开产品）
 *   POST /api/products          → 创建（SKU 未提供时后端自动生成）
 *   PUT  /api/products/:id      → 更新（partial；可见即可编辑，授权门在后端）
 *
 * **不封装**（不在 F-S1 范围）：DELETE /import /template /mixed /sku-preview。
 *
 * `options`（GET /api/products/options）**不在此重复实现** —— 它已由 Round F-4 提供
 * （api/masterData.ts `getProductOptions`，经 master data store 做 TTL 缓存 + 会话隔离），
 * 本文件仅**再导出**同一实现，避免同一端点出现两套封装。Product Select 的数据能力
 * 见 pages/products/ProductSelect.tsx（消费 useMasterData().productOptions）。
 *
 * 权限：product 路由仅 `authenticate`，无 requirePerm；可见性由后端谓词收敛
 * （PUBLIC ∨ 本人创建的 PRIVATE ∨ 被指定的 PRIVATE）—— 前端**不做**任何过滤放宽。
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
export const productApi = {
  list: (params?: ProductListQuery) =>
    request.get<ApiResponse<PageResult<ProductListItem>>>('/products', { params: toParams(params) }),
  detail: (id: string) => request.get<ApiResponse<ProductDetail>>(`/products/${encodeURIComponent(id)}`),
  create: (payload: ProductCreatePayload) => request.post<ApiResponse<ProductMutated>>('/products', payload),
  update: (id: string, payload: ProductUpdatePayload) =>
    request.put<ApiResponse<ProductMutated>>(`/products/${encodeURIComponent(id)}`, payload),
};

/** 产品分页列表（形状校验：list/total/page/pageSize 必须存在且类型正确） */
export const getProducts = async (params?: ProductListQuery): Promise<PageResult<ProductListItem>> =>
  unwrapPage<ProductListItem>(await productApi.list(params), 'GET /products');

/** 产品详情（不存在 / 无权 → 后端 404/403，错误向上抛，不吞成 null） */
export const getProduct = async (id: string): Promise<ProductDetail> =>
  unwrapResponse(await productApi.detail(id), 'GET /products/:id').data;

/** 创建产品（POST /api/products） */
export const createProduct = async (payload: ProductCreatePayload): Promise<ProductMutated> =>
  unwrapResponse(await productApi.create(payload), 'POST /products').data;

/** 更新产品（PUT /api/products/:id；未传字段后端保持原值） */
export const updateProduct = async (id: string, payload: ProductUpdatePayload): Promise<ProductMutated> =>
  unwrapResponse(await productApi.update(id, payload), 'PUT /products/:id').data;

/**
 * 产品选项（供 Product Select 使用）
 * 与 master data store 使用**同一实现**（单一事实来源），不复制请求逻辑。
 */
export { getProductOptions as listProductOptions } from './masterData';
