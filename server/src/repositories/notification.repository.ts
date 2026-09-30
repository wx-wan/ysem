import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Notification 数据访问 —— Round R-5 · T2（D-P6-B）
 *
 * 归属：Data Layer。
 *
 * 【为什么从 `notification.ts` 抽出】原实现把三类关注点混在一处：
 *   ① **Data**：`notification` 的 create / findMany / updateMany（本次归位到本仓储）
 *   ② **HTTP transport**：SSE 在线连接表（`Map<userId, Set<Response>>`）
 *   ③ **能力编排**：`pushNotification`（写库 + 推送）
 * ① 属 Data ⇒ 归位；②③ 保留在 `src/notification/notification.service.ts`
 *（其中 Express `Response` 依赖是**传输层**事实，不属越界）。
 *
 * 本仓储只做持久化；「推送失败不影响落库」等编排语义属调用方。
 */
const model = (db: DbClient) => (db as typeof prisma).notification;

/** 未读通知拉取上限（既有实现：50） */
const UNREAD_TAKE = 50;

export const notificationRepository = {
  create(data: Prisma.NotificationUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  /** 拉取用户未读通知（SSE 首连时使用） */
  findUnread(userId: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: { userId, read: false },
      orderBy: { createdAt: 'desc' },
      take: UNREAD_TAKE,
    });
  },

  /** 将用户全部未读通知标记为已读 */
  markAllRead(userId: string, db: DbClient = prisma) {
    return model(db).updateMany({ where: { userId, read: false }, data: { read: true } });
  },
};
