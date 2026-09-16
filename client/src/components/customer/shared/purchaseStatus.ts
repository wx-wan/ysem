import type { Customer } from '../../../api/customers';

// ========== 客户成交状态（全站唯一收口） ==========
// 两个通用方法，供标签、排序、层级配色等所有场景复用：
//   1) getFirstOrderDate  —— 取客户首单日期（V1.0 canonical：Customer.firstOrderAt）
//   2) getPurchaseStatus  —— 基于首单日期判断成交状态：未成交客户 / 本年度新客 / 往年老客

/** 成交状态枚举 */
export type PurchaseStatus = 'prospect' | 'new' | 'old';

/** 状态对应中文前缀（用于「状态·采购意向」标签前半段） */
export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  prospect: '未成交客户',
  new: '本年度新客',
  old: '往年老客',
};

/**
 * 方法1：取得客户首单日期（V1.0 canonical）。
 *
 * 数据源：`Customer.firstOrderAt`（Prisma `DateTime?`，JSON 为 ISO 字符串），由履约层回写：
 *   · 该字段为 null ⇔ 无成交（server `getCustomerStats` 亦以 `firstOrderAt: null` 表达「无订单客户」）
 *   · 该字段为 scalar，**所有** Customer endpoint 均返回（无需 relation / 无需明细）
 *
 * 不再读取：`customer.orders`（列表端点不返回明细，getById 亦非权威聚合来源）
 *           与旧 `customer.firstOrderDate`（String，服务端已 RENAME 为 firstOrderAt）。
 *
 * 规则保持不变（不新增业务状态）：无值 → 无首单；返回 YYYY-MM-DD 前缀。
 */
export function getFirstOrderDate(customer: Customer): string | undefined {
  const fy = customer.firstOrderAt;
  return fy ? fy.slice(0, 10) : undefined;
}

/**
 * 方法2：基于首单日期判断成交状态。
 *   - 无首单（无订单记录）        → prospect（未成交客户）
 *   - 首单年份 == 本年度          → new（本年度新客）
 *   - 首单年份 < 本年度           → old（往年老客）
 */
export function getPurchaseStatus(customer: Customer): PurchaseStatus {
  const fy = getFirstOrderDate(customer);
  if (!fy) return 'prospect';
  const year = new Date().getFullYear().toString();
  return fy.startsWith(year) ? 'new' : 'old';
}

/** 取得成交状态中文前缀（如「本年度新客」） */
export function getPurchaseStatusLabel(customer: Customer): string {
  return PURCHASE_STATUS_LABEL[getPurchaseStatus(customer)];
}
