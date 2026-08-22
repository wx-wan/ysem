import prisma from './prisma';
import { DiffItem, serializeDiff } from './operation-diff';

// ============================================================
// 统一活动日志服务
// 所有模块的增删改操作统一通过此服务记录
// 写入路径：OperationLog（全局审计） + CustomerActivity（客户时间线） + ProductActivity（产品时间线）
// 统一字段：realName（操作人姓名）、summary（做了什么）、diff（结构化变更）
// ============================================================

export interface LogEntry {
  userId: string;
  username: string;
  action: string;
  module: string;
  targetId?: string;
  target?: string;
  /** 人类可读摘要（如「修改了产品」）；同时写入 summary / detail 保持兼容 */
  detail?: string;
  /** 操作人姓名（昵称） */
  realName?: string;
  /** 结构化变更列表 */
  diff?: DiffItem[];
  ip?: string;
  /** 如果提供了 customerId，同步写入客户活动时间线 */
  customerId?: string;
  /** 如果提供了 productId，同步写入产品操作记录时间线 */
  productId?: string;
}

class ActivityLogger {
  /**
   * 记录一条操作日志
   * - 始终写入 OperationLog（全局审计日志）
   * - 如果提供了 customerId，同步写入 CustomerActivity（客户详情时间线）
   * - 如果提供了 productId，同步写入 ProductActivity（产品详情时间线）
   */
  async log(entry: LogEntry): Promise<void> {
    const writes: Promise<unknown>[] = [];
    const diffStr = serializeDiff(entry.diff);

    // 1. 全局操作日志
    writes.push(
      prisma.operationLog.create({
        data: {
          userId: entry.userId,
          username: entry.username,
          realName: entry.realName,
          action: entry.action,
          module: entry.module,
          targetId: entry.targetId,
          target: entry.target || entry.targetId,
          detail: entry.detail,
          summary: entry.detail,
          diff: diffStr,
          ip: entry.ip,
        },
      })
    );

    // 2. 客户活动时间线
    if (entry.customerId) {
      writes.push(
        prisma.customerActivity.create({
          data: {
            customerId: entry.customerId,
            action: entry.action,
            detail: entry.detail,
            summary: entry.detail,
            diff: diffStr,
            realName: entry.realName,
            createdBy: entry.username,
          },
        })
      );
    }

    // 3. 产品操作记录时间线
    if (entry.productId) {
      writes.push(
        prisma.productActivity.create({
          data: {
            productId: entry.productId,
            action: entry.action,
            detail: entry.detail,
            summary: entry.detail,
            diff: diffStr,
            operator: entry.username,
            realName: entry.realName,
            createdBy: entry.userId,
          },
        })
      );
    }

    await Promise.all(writes);
  }
}

export const activityLogger = new ActivityLogger();
