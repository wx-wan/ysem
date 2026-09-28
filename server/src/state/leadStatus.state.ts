import type { LeadStatus } from '@prisma/client';

/**
 * Lead 状态规则 —— Round R-5 · Phase 3 · State Capability
 *
 * 【State 能力边界（冻结）】
 *   State **只**负责状态、状态转换、派生状态与状态判断；
 *   **不**访问 Prisma、**不**访问 HTTP、**不**执行数据库事务、**不**承担跨域编排。
 *   ⇒ 本文件必须保持**纯函数 / 纯常量**（无副作用、无 IO、无 import 单例）。
 *   持久化与编排在 `operations/state.operations.ts`。
 *
 * 【业务语义冻结（沿用既有实现，未改）】
 *   线索状态（4 态）：NEW → CONFIRMED → SAMPLED → WON
 *   状态**只能由单据事件自动推进**，不允许人工改动：
 *     · 创建线索                         → NEW
 *     · 线索绑定商机（Opportunity.leadId）→ CONFIRMED
 *     · 该商机下生成打样单                → SAMPLED
 *     · 该商机下生成销售订单              → WON
 *   打样单 / 销售订单只关联 `opportunityId`，故线索侧经**商机间接追溯**
 *   （Lead → Opportunity → 单据），不在 Lead 上冗余 sampleOrderId / salesOrderId 列。
 */

/** 状态递进顺序：只允许向前推进，不允许回退或降级 */
export const LEAD_STATUS_RANK: Record<LeadStatus, number> = {
  NEW: 0,
  CONFIRMED: 1,
  SAMPLED: 2,
  WON: 3,
};

/** 由低到高的状态序列（业务顺序，不依赖 enum 声明顺序） */
export const LEAD_STATUS_ORDER: LeadStatus[] = ['NEW', 'CONFIRMED', 'SAMPLED', 'WON'];

/** 状态中文名（4 态；状态由单据事件自动推进，无人工改动入口） */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: '新线索',
  CONFIRMED: '已确认',
  SAMPLED: '已打样',
  WON: '已成交',
};

/**
 * 是否应当推进：目标状态**严格高于**当前状态才推进。
 * 已处于同级 / 更高状态时不变（不降级、不重复写入）。
 */
export function shouldAdvanceLeadStatus(current: LeadStatus, next: LeadStatus): boolean {
  return LEAD_STATUS_RANK[next] > LEAD_STATUS_RANK[current];
}
