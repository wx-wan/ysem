import { Spin, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * 登录态路由守卫（F-1 §10）：
 *   · ready === false（启动恢复中）→ 显示最基础 Loading，**不误跳登录页**
 *   · 未登录 → 重定向 /login（携带来源，便于后续回跳）
 *   · 已登录 → 渲染子内容
 *
 * 本轮只判断「已认证 / 未认证」，不涉及功能权限与数据范围（留给 F-2）。
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const ready = useAuthStore((s) => s.ready);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  if (!ready) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 120 }}>
        {/* 不使用 Spin 的 tip/description（antd 6 已弃用），避免控制台告警 */}
        <Spin />
        <Typography.Text type="secondary">Loading...</Typography.Text>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
