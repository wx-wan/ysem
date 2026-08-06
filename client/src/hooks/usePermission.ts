import { useAuthStore } from '../stores/useAuthStore';

/**
 * 权限判断钩子
 * - admin 的 permissions 为 ['*']，视为拥有全部权限
 * - hasPerm(code) 判断单个权限
 * - hasAnyPerm(codes) 判断拥有其中任意一个
 */
export function usePermission() {
  const permissions = useAuthStore((s) => s.permissions);
  const isAdmin = useAuthStore((s) => s.user?.role?.code === 'admin');

  const hasPerm = (code: string): boolean => {
    if (isAdmin) return true;
    return permissions.includes(code);
  };

  const hasAnyPerm = (codes: string[]): boolean => {
    if (isAdmin) return true;
    return codes.some((c) => permissions.includes(c));
  };

  return { permissions, isAdmin, hasPerm, hasAnyPerm };
}
