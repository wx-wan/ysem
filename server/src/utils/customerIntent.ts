import type { IntentLevel } from '@prisma/client';

/**
 * 客户意向等级（D-INTENT v2）：**不再落库**，统一由关联商机**读时派生**。
 *
 * 规则（Round F-8B 冻结）：
 *   Customer.intentLevel = max(该 Customer 全部 Opportunity.intentLevel)
 *   优先级（业务顺序，**不依赖 enum 声明顺序**）：LOW < MEDIUM < HIGH < READY
 *   无商机 / 全部商机 intentLevel 为 null → null（API 返回 `null`，UI 显示「无意向」）
 *
 * 架构边界：
 *   · 存储列 `Customer.intentLevel` 降级为 legacy：**不写入**、**不作为读取来源**（不删列、不迁移）
 *   · `Opportunity.intentLevel` 仍为人工维护的商机自身字段，不受本模块影响
 *   · 商机 create / update / delete / batchDelete / import **无需**任何 Customer 回写
 *     （读时派生 ⇒ sales.controller 零改动）
 *
 * 本模块只做纯计算与响应投影，**绝不产生任何持久化写入**。
 */

/** 意向优先级（数值越大优先级越高）。显式定义业务顺序，禁止依赖 enum 声明顺序。 */
const INTENT_PRIORITY: Record<IntentLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  READY: 4,
};

/** 由低到高的等级序列（供调用方输出稳定顺序，避免依赖 DB/enum 顺序） */
export const INTENT_LEVEL_ORDER: IntentLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'READY'];

/** 商机意向信号（只要求 intentLevel 存在，允许附加字段） */
export interface CustomerIntentSignals {
  intentLevel?: IntentLevel | null;
}

/**
 * 单个客户的派生意向：取全部商机意向的最高等级。
 *
 * · 无数组 / 空数组 → null
 * · 全部 intentLevel 为 null → null
 * · 否则返回优先级最高的等级
 */
export function deriveCustomerIntentLevel(
  opportunities?: ReadonlyArray<CustomerIntentSignals | null> | null,
): IntentLevel | null {
  let best: IntentLevel | null = null;
  for (const item of opportunities ?? []) {
    const level = item?.intentLevel ?? null;
    if (level === null) continue;
    if (best === null || INTENT_PRIORITY[level] > INTENT_PRIORITY[best]) best = level;
  }
  return best;
}

/**
 * 批量派生：输入 `prisma.opportunity.groupBy({ by: ['customerId', 'intentLevel'] })` 的结果行，
 * 在**内存中**聚合为 `Map<customerId, 最高意向>`（无商机/全 null 的客户值为 null）。
 *
 * ⇒ 一次 groupBy、无 N+1、无逐客户查询；与 `utils/pipelineStage.ts` 的批量派生思想一致。
 */
export function deriveCustomerIntentLevels(
  rows: ReadonlyArray<{ customerId?: string | null; intentLevel?: IntentLevel | null }>,
): Map<string, IntentLevel | null> {
  const result = new Map<string, IntentLevel | null>();
  for (const row of rows) {
    const customerId = row?.customerId;
    if (!customerId) continue;
    const level = row.intentLevel ?? null;

    if (!result.has(customerId)) {
      result.set(customerId, level);
      continue;
    }
    const current = result.get(customerId) ?? null;
    if (level !== null && (current === null || INTENT_PRIORITY[level] > INTENT_PRIORITY[current])) {
      result.set(customerId, level);
    }
  }
  return result;
}

/**
 * 响应投影：以派生值**覆盖** `Customer.intentLevel`（纯函数，不写库）。
 *
 * 入参需携带该客户的 `opportunities[].intentLevel`；若未携带（如 create 刚创建的客户，
 * 必无商机）则派生结果为 `null` —— 与统一 API contract 一致。
 */
export function withCustomerIntent<T extends { opportunities?: ReadonlyArray<CustomerIntentSignals | null> | null }>(
  customer: T,
): Omit<T, 'intentLevel'> & { intentLevel: IntentLevel | null } {
  return { ...customer, intentLevel: deriveCustomerIntentLevel(customer.opportunities) };
}
