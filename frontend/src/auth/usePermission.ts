import { useCallback, useMemo } from 'react';
import type { PermissionCode } from '../types/auth';
import { getUserPermissions, hasPermission, isAdminUser } from './permissionUtils';
import { useCurrentUser } from './useCurrentUser';

export interface PermissionContextValue {
  /** 权限码数组（未登录 → []） */
  permissions: PermissionCode[];
  /** admin 由 role.code 判定 */
  isAdmin: boolean;
  /** 单权限判定：未登录 false · admin true · 其他精确匹配 */
  hasPerm: (code: string) => boolean;
}

/**
 * Permission Context（选择器实现）。
 *
 * 严格遵循后端语义（Round F-0 §5 / F-2 §6-§7）：
 *   · admin 由 `user.role.code === 'admin'` 判定（**不**以 permissions.includes('*') 作为唯一依据）
 *   · 仅精确匹配权限码，不做前缀 / 通配符 / 模糊匹配
 *   · 权限数组与 user 同源（Auth Store），本层不另存副本
 *
 * 注意：前端权限仅用于 UI 控制，后端 requirePerm / 数据范围始终是最终权威。
 */
export function usePermission(): PermissionContextValue {
  const { user } = useCurrentUser();

  const permissions = useMemo(() => getUserPermissions(user), [user]);
  const isAdmin = useMemo(() => isAdminUser(user), [user]);
  const hasPerm = useCallback((code: string) => hasPermission(user, code), [user]);

  return { permissions, isAdmin, hasPerm };
}

export default usePermission;
