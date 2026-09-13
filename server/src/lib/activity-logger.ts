import prisma from './prisma';
import { DiffItem, serializeDiff } from './operation-diff';
import type { BusinessType } from './business-type';

// ============================================================
// 统一活动日志服务（V1.0）
//
// V1.0 只有三个合法活动落点：
//   1. OperationLog        —— 全局审计日志（**唯一必写**落点）
//   2. CustomerActivity    —— 客户时间线（提供 customerId 时追加写入）
//   3. OpportunityActivity —— 销售时间线（由销售域自行写入，本服务不代写）
//
// 旧 `ProductActivity` 在 V1.0 已删除，产品/组合操作只落 `OperationLog`
// （businessType = PRODUCT / COMBO）；产品打样/进度属业务数据，落 `ProductTask`，
// 不走本服务。**禁止**新建 ProductActivity / Activity / GenericActivity。
//
// 字段收口：旧裸字符串 `target` / `targetId` / `detail` 已废弃，统一为
// `businessType` / `businessId` / `businessNo` / `summary`。
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

  /** 提供时同步写入客户时间线 CustomerActivity */
  customerId?: string;
}

class ActivityLogger {
  /**
   * 记录一条操作日志。
   * - 始终写入 OperationLog（全局审计日志）
   * - 提供 customerId 时同步写入 CustomerActivity（客户详情时间线）
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
        },
      })
    );

    // 2. 客户时间线
    // CustomerActivity 在 V1.0 保留 detail / summary 双字段，客户详情时间线读取 detail，
    // 因此两列都写入同一摘要值。
    if (entry.customerId) {
      writes.push(
        prisma.customerActivity.create({
          data: {
            customerId: entry.customerId,
            action: entry.action,
            detail: entry.summary,
            summary: entry.summary,
            diff: diffStr,
            realName: entry.realName,
            createdBy: entry.username,
          },
        })
      );
    }

    await Promise.all(writes);
  }
}

export const activityLogger = new ActivityLogger();
