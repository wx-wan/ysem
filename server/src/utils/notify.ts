import type { Response } from 'express';
import prisma from '../lib/prisma';

/**
 * 轻量通知服务（基于 SSE）
 *
 * 统一承载权限变更、审批、系统公告等通知：
 *  - 在线用户：经 SSE 长连接实时推送
 *  - 离线用户：落库 Notification，下次建立 SSE 连接时由 /api/auth/events 拉取未读
 *
 * 单实例：在线连接维护在内存 Map<userId, Set<Response>>。
 * 多实例扩展：仅把 sendTo 的广播改为 Redis pub/sub 即可，写库/读取接口不变。
 */

export interface NotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}

// 在线 SSE 连接：userId -> 该用户所有连接（多标签页）
const connections = new Map<string, Set<Response>>();

export const addConnection = (userId: string, res: Response): void => {
  let set = connections.get(userId);
  if (!set) {
    set = new Set();
    connections.set(userId, set);
  }
  set.add(res);
};

export const removeConnection = (userId: string, res: Response): void => {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) connections.delete(userId);
};

const sendTo = (userId: string, data: unknown): void => {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    res.write(payload);
  }
};

/**
 * 发送一条通知：写库 + 向在线用户实时推送。
 * 返回创建的通知记录（供调用方需要 id 时）；推送失败不影响落库。
 */
export const pushNotification = async (input: NotificationInput) => {
  const record = await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      payload: (input.payload ?? undefined) as object | undefined,
    },
  });
  sendTo(input.userId, { event: 'NOTIFICATION', data: record });
  return record;
};

/**
 * 广播通知给所有在线用户（如系统公告）。只推在线用户，离线用户的公告可在
 * notifyAll 额外写库；此处仅做在线推送，公告全量持久化由调用方自行决定。
 */
export const notifyOnline = (type: string, title: string, body?: string, payload?: Record<string, unknown>): void => {
  const data = { event: 'NOTIFICATION', data: { type, title, body, payload, id: null, createdAt: new Date().toISOString() } };
  const payloadStr = `data: ${JSON.stringify(data)}\n\n`;
  for (const set of connections.values()) {
    for (const res of set) res.write(payloadStr);
  }
};

/** 拉取用户未读通知（SSE 首连时使用），可选一并标记已读 */
export const fetchUnread = async (userId: string, markRead = false) => {
  const list = await prisma.notification.findMany({
    where: { userId, read: false },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  if (markRead && list.length > 0) {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
  return list;
};
