import prisma from './prisma';
import { DiffItem, serializeDiff } from './operation-diff';
import type { BusinessType } from './business-type';

// ============================================================
// 统一活动日志服务（V1.0 整合版）
//
// **唯一合法落点：OperationLog（全局审计日志）**。所有系统操作只写这一张表，
// 不重复建记录。各业务模块（线索 / 产品 / 客户 / 商机 …）通过 businessType +
// businessId（客户维度另加 customerId）从 OperationLog 直接捞取自己的操作记录。
//
// 历史副表已废弃删除：
//   - `CustomerActivity`：其角色（客户时间线，含跨实体事件）由 OperationLog.customerId 承担。
//   - `OpportunityActivity`：商机创建等事件统一以 action=OPPORTUNITY_CREATED 落 OperationLog
//     （businessType=OPPORTUNITY）。
//   - 旧 `ProductActivity` 早已删除，产品/组合操作只落 OperationLog（businessType=PRODUCT/COMBO）。
//
// **禁止**新建 CustomerActivity / OpportunityActivity / ProductActivity / Activity / GenericActivity 等副表。
//
// 字段收口：旧裸字符串 `target` / `targetId` / `detail` 已废弃，统一为
// `businessType` / `businessId` / `businessNo` / `summary` / `customerId`。
// ============================================================

export interface LogEntry {
  /** 操作人 id（无外键，用户删除后日志仍存活） */
  userId: string;
  username: string;
  /** 操作人姓名（昵称） */
  realName?: string;

  action: string;
  /** 业务模块（masterdata / sales / fulfillment / system） */
  module: string;

  /** 业务对象类型，取值见 BUSINESS_TYPE；不再使用裸字符串 target */
  businessType?: BusinessType;
  /** 业务对象主键；不再使用 targetId */
  businessId?: string;
  /** 冗余单据号，便于人眼检索 */
  businessNo?: string;
  /** 人类可读摘要（如「创建了产品「XX」」） */
  summary?: string;

  /** 结构化变更列表 */
  diff?: DiffItem[];
  ip?: string;

  /** 业务对象归属客户（可选）。写入 OperationLog.customerId，使客户时间线可按 customerId 捞出跨实体事件 */
  customerId?: string;
}

class ActivityLogger {
  /**
   * 记录一条操作日志。
   * - 始终写入 OperationLog（全局审计日志，唯一落点）
   * - 提供 customerId 时一并写入 customerId，使客户时间线可直接按 customerId 捞出（含跨实体事件）
   */
  async log(entry: LogEntry): Promise<void> {
    const writes: Promise<unknown>[] = [];
    const diffStr = serializeDiff(entry.diff);

    // 1. 全局审计日志（必写）
    writes.push(
      prisma.operationLog.create({
        data: {
          userId: entry.userId,
          username: entry.username,
          realName: entry.realName,
          action: entry.action,
          module: entry.module,
          businessType: entry.businessType,
          businessId: entry.businessId,
          businessNo: entry.businessNo,
          summary: entry.summary,
          diff: diffStr,
          ip: entry.ip,
          // 客户归属：写入后客户时间线即可通过 customerId 直接从 OperationLog 捞出
          // （含跨实体事件，如「创建/更新了关联该客户的线索、商机」），无需 CustomerActivity 副表。
          customerId: entry.customerId ?? null,
        },
      })
    );

    await Promise.all(writes);
  }
}

export const activityLogger = new ActivityLogger();
