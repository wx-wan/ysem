import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { addConnection, removeConnection, fetchUnread } from '../utils/notify';

interface JwtPayload {
  userId: string;
  username: string;
  realName?: string;
  roleCode: string;
}

/**
 * SSE 通知流端点：GET /api/auth/events?token=xxx
 * 因 EventSource 不支持自定义 Header，token 通过 query 传递。
 * 连接建立后：先推送该用户未读通知（首连补偿离线消息），随后保持长连接实时推送。
 */
export const events = async (req: Request, res: Response): Promise<void> => {
  const token = (req.query.token as string) || '';
  if (!token) {
    res.status(401).json({ code: 401, message: '未提供认证令牌' });
    return;
  }

  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
  } catch {
    res.status(401).json({ code: 401, message: '认证令牌无效或已过期' });
    return;
  }

  const userId = decoded.userId;

  // SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');

  // 首连：补偿离线期间的未读通知
  try {
    const unread = await fetchUnread(userId, true);
    for (const n of unread) {
      res.write(`data: ${JSON.stringify({ event: 'NOTIFICATION', data: n })}\n\n`);
    }
  } catch {
    /* 忽略补偿失败，不中断连接 */
  }

  // 注册在线连接
  addConnection(userId, res);

  // 心跳保活，避免代理断开空闲连接
  const ping = setInterval(() => {
    res.write(': ping\n\n');
  }, 25000);

  const cleanup = () => {
    clearInterval(ping);
    removeConnection(userId, res);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
};
