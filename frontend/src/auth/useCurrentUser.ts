import { useEffect } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import type { CurrentUser } from '../types/auth';
import { detectProfileAnomalies } from './permissionUtils';

export interface CurrentUserContextValue {
  /** Current User（唯一来源：GET /api/auth/profile，经 Auth Store 持有） */
  user: CurrentUser | null;
  isAuthenticated: boolean;
  /** 启动恢复是否完成（false 期间路由守卫不跳转） */
  isReady: boolean;
}

/**
 * Current User Context（选择器实现）。
 *
 * 页面只依赖本 hook，不直接读取 Auth Store 内部结构（Round F-2 §4 / §16）。
 * 本层**不持有**自己的 user 副本，始终读同一份 Auth Store 状态，避免状态漂移。
 */
export function useCurrentUser(): CurrentUserContextValue {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.ready);

  // profile 异常形状只记录（不打印敏感数据），前端按安全默认值继续运行
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const issues = detectProfileAnomalies(user);
    if (issues.length > 0) {
      // eslint-disable-next-line no-console
      console.warn('[auth] profile 形状异常，已按安全默认值处理:', issues.join(', '));
    }
  }, [isAuthenticated, user]);

  return { user, isAuthenticated, isReady };
}

export default useCurrentUser;
