import { useEffect } from 'react';
import { useAuthStore } from './useAuthStore';
import { useUserStore } from './useUserStore';

interface PushNotification {
  id: string | null;
  type: string;
  title: string;
  body?: string;
  payload?: { roleId?: string };
  read?: boolean;
  createdAt?: string;
}

/**
 * 连接后端 SSE 通知流（/api/auth/events），处理实时通知：
 *  - PERM_CHANGED：通知当前用户所属角色发生权限/数据范围变更，由 MainLayout 用自定义 AppModal 弹确认框
 *  - 其他类型：存入通知中心（后期扩展）
 *
 * token 通过 query 传递（EventSource 不支持自定义 Header）。
 */
export const useNotificationStream = () => {
  const { accessToken, ready } = useAuthStore();

  useEffect(() => {
    if (!ready || !accessToken) return;

    const es = new (window as any).EventSource(
      `/api/auth/events?token=${encodeURIComponent(accessToken)}`,
    );

    es.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event !== 'NOTIFICATION') return;
        const n: PushNotification = msg.data;
        if (n.type === 'PERM_CHANGED') {
          const roleId = n.payload?.roleId;
          if (roleId) useUserStore.getState().notifyPermChanged(roleId);
        } else {
          // 其他通知类型后续扩展通知中心，这里暂以控制台提示兜底
          // eslint-disable-next-line no-console
          console.info('[notification]', n.type, n.title);
        }
      } catch {
        /* 忽略非 JSON 消息（如心跳注释行） */
      }
    };

    es.onerror = () => {
      // 断线后浏览器会自动按 retry 重连；这里不主动关闭
    };

    return () => es.close();
  }, [accessToken, ready]);
};
