import type { Lead, LeadCustomer } from '../api/lead';

/**
 * 线索客户信息的**统一取值入口**。
 *
 * 规则（V1.2）：暂存（未建档）线索**不创建客户**，客户信息只存在线索快照里；
 * 建档后才在客户库创建正式客户并绑定 `customerId`。故：
 *   · 已关联客户 → `lead.customer`（客户库关系，权威）
 *   · 暂存期     → `lead.customerSnapshot`（快照内 companyName / contactName /
 *                   contactMethods / email / phone / country / customerType / 来源 等）
 *
 * 组件里不要再直接写 `lead.customer?.companyName`，否则暂存线索一律显示为空。
 */
export function resolveLeadCustomer(
  lead?: Pick<Lead, 'customer' | 'customerSnapshot'> | null,
): LeadCustomer | null {
  if (!lead) return null;
  return lead.customer ?? lead.customerSnapshot ?? null;
}

/**
 * 是否处于「暂存（未建档）」态：无客户关系且客户信息尚未建档。
 * 用于区分「暂存客户信息只在线索快照里」与「已建档客户」。
 */
export function isDraftLead(
  lead?: Pick<Lead, 'customerId' | 'customerLocked'> | null,
): boolean {
  if (!lead) return false;
  return !lead.customerId && !lead.customerLocked;
}
