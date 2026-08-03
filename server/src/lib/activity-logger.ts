import prisma from './prisma';

// ============================================================
// 统一活动日志服务
// 所有模块的增删改操作统一通过此服务记录
// 写入路径：OperationLog（全局审计） + CustomerActivity（客户时间线）
// ============================================================

export interface LogEntry {
  userId: string;
  username: string;
  action: string;
  module: string;
  targetId?: string;
  target?: string;
  detail?: string;
  ip?: string;
  /** 如果提供了 customerId，同步写入客户活动时间线 */
  customerId?: string;
}

class ActivityLogger {
  /**
   * 记录一条操作日志
   * - 始终写入 OperationLog（全局审计日志）
   * - 如果提供了 customerId，同步写入 CustomerActivity（客户详情时间线）
   */
  async log(entry: LogEntry): Promise<void> {
    const writes: Promise<unknown>[] = [];

    // 1. 全局操作日志
    writes.push(
      prisma.operationLog.create({
        data: {
          userId: entry.userId,
          username: entry.username,
          action: entry.action,
          module: entry.module,
          target: entry.target || entry.targetId,
          detail: entry.detail,
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
            createdBy: entry.username,
          },
        })
      );
    }

    await Promise.all(writes);
  }
}

export const activityLogger = new ActivityLogger();
