import type { ReactNode } from 'react';
import { usePermission } from './usePermission';

export interface PermissionGateProps {
  /** 需要具备的权限码（后端真实权限码，如 `customers`、`system:user:create`） */
  permission: string;
  children: ReactNode;
}

/**
 * 最小权限门（Round F-2 §12）：有权限渲染 children，无权限渲染 null。
 *
 * 本轮刻意不做：403 页面 / 复杂 fallback / 权限错误通知 / 动态权限请求。
 * ⚠️ 仅 UI 层控制，不构成安全边界 —— 后端接口仍会独立校验。
 */
export default function PermissionGate({ permission, children }: PermissionGateProps) {
  const { hasPerm } = usePermission();
  return hasPerm(permission) ? <>{children}</> : null;
}
