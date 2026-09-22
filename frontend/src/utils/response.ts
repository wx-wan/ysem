import type { AxiosResponse } from 'axios';
import type { ApiResponse } from '../api/request';
import type { PageResult } from '../types/masterData';

/**
 * 响应解包 helper（Round F-4 §7）
 *
 * F-1 约定：axios response **不在 interceptor 中解包**，调用方拿到的是
 *   AxiosResponse<ApiResponse<T>>，其中 ApiResponse<T> = { code, message, data }。
 *
 * 本文件只提供极小的纯函数，把「信封 → 业务数据」这一步显式化，并**严格校验形状**：
 * 形状不符时抛错，而不是静默降级为 [] / undefined —— 静默会把后端契约变更隐藏起来。
 */

export class ResponseShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResponseShapeError';
  }
}

const describe = (source?: string): string => (source ? `（${source}）` : '');

/** 取信封本体：AxiosResponse<ApiResponse<T>> → ApiResponse<T>（不做二次解包） */
export function unwrapResponse<T>(response: AxiosResponse<ApiResponse<T>>, source?: string): ApiResponse<T> {
  const payload = response?.data;
  if (!payload || typeof payload !== 'object' || typeof payload.code !== 'number') {
    throw new ResponseShapeError(`响应不是合法的 ApiResponse 信封${describe(source)}`);
  }
  return payload;
}

/**
 * 取信封内的数组数据。
 * 要求 `data` **必须是数组**；否则抛出 ResponseShapeError（不返回 []）。
 */
export function unwrapArray<T>(response: AxiosResponse<ApiResponse<T[]>>, source?: string): T[] {
  const payload = unwrapResponse(response, source);
  if (!Array.isArray(payload.data)) {
    throw new ResponseShapeError(
      `期望 data 为数组，实际为 ${payload.data === null ? 'null' : typeof payload.data}${describe(source)}`,
    );
  }
  return payload.data;
}

/**
 * 取信封内的分页数据。
 * 要求 `data.list` 为数组且 `total / page / pageSize` 为数字；否则抛出 ResponseShapeError。
 * （当前 master data 均为数组型；本 helper 供后续分页列表端点消费。）
 */
export function unwrapPage<T>(response: AxiosResponse<ApiResponse<PageResult<T>>>, source?: string): PageResult<T> {
  const payload = unwrapResponse(response, source);
  const data = payload.data as Partial<PageResult<T>> | null | undefined;
  if (!data || typeof data !== 'object' || !Array.isArray(data.list)) {
    throw new ResponseShapeError(`期望 data.list 为数组${describe(source)}`);
  }
  for (const field of ['total', 'page', 'pageSize'] as const) {
    if (typeof data[field] !== 'number') {
      throw new ResponseShapeError(`期望 data.${field} 为数字${describe(source)}`);
    }
  }
  return data as PageResult<T>;
}

/**
 * 「分页 + 扩展字段」响应的解包（F-5 additive 扩展，**未改动既有 helper 签名**）。
 *
 * 用于 Customer /my、/all 这类在分页之上附带 stats / 统计聚合的端点：
 *   · 复用 unwrapPage 做分页形状校验（list / total / page / pageSize）；
 *   · 返回**含扩展字段**的完整 data，并保留 `R` 的精确静态类型（不截断为 PageResult）。
 */
export function unwrapPageWithExtras<T, R extends PageResult<T>>(
  response: AxiosResponse<ApiResponse<R>>,
  source?: string,
): R {
  unwrapPage<T>(response, source);
  return unwrapResponse(response, source).data;
}
