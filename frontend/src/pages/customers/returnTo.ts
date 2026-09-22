/**
 * 列表 → 详情 → 返回 的位置记忆（Round F-7 §25）
 *
 * 目的：从客户列表带筛选/分页进入详情后，「返回客户列表」应回到原 URL
 *       （如 `/data/customers?view=my&page=2`），而不是无条件回到 `/data/customers`。
 *
 * 实现选择：sessionStorage（而非 router location.state）——
 *   · 无需对 `location.state` 做类型断言，保持零 any / 零 as 断言；
 *   · 详情页刷新后仍能正确返回（location.state 在刷新后保留与否依赖实现细节）。
 *
 * 安全：只接受以 '?' 开头的查询串，其余一律丢弃（防止被写入任意路径）。
 */

const KEY = 'ysem.customerList.returnSearch';

/** 列表页跳转详情前调用：记住当前列表查询串 */
export const rememberListSearch = (search: string): void => {
  try {
    if (search.startsWith('?')) sessionStorage.setItem(KEY, search);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* sessionStorage 不可用时静默降级（返回时回到默认列表页） */
  }
};

/** 详情页「返回客户列表」的目标路径 */
export const getListReturnPath = (): string => {
  try {
    const search = sessionStorage.getItem(KEY);
    return search && search.startsWith('?') ? `/data/customers${search}` : '/data/customers';
  } catch {
    return '/data/customers';
  }
};
