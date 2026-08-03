import type { Customer, Order } from '../../../api/customers';

// ========== 客户成交状态（全站唯一收口） ==========
// 两个通用方法，供标签、排序、层级配色等所有场景复用：
//   1) getFirstOrderDate  —— 从订单列表取「创建时间最早」的订单日期（数据驱动，不依赖后端冗余字段）
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
 * 方法1：取得客户首单日期。
 * 规则：优先取 orders 中 createdAt 最早的订单日期（YYYY-MM-DD）。
 * 列表场景下 orders 明细未随列表接口返回（仅有聚合字段 totalAmount/lastOrderDate），
 * 此时回退到后端冗余字段 firstOrderDate，避免已成交客户在卡片视图被误判为「未成交客户」。
 */
export function getFirstOrderDate(customer: Customer): string | undefined {
  const orders: Order[] | undefined = customer.orders;
  if (orders && orders.length > 0) {
    // 优先使用 orderDate（实际成交日期），回退到 createdAt（技术创建时间）
    let earliest = orders[0].orderDate || orders[0].createdAt;
    for (const o of orders) {
      const d = o.orderDate || o.createdAt;
      if (d && (!earliest || d < earliest)) earliest = d;
    }
    return earliest ? earliest.slice(0, 10) : undefined;
  }
  // 无 orders 明细（列表视图）→ 回退冗余字段 firstOrderDate
  const fy = customer.firstOrderDate;
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
