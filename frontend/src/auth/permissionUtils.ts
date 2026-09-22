import type { CurrentUser, DataScope, PermissionCode } from '../types/auth';

/**
 * 权限 / 数据范围 **纯函数** 工具层。
 *
 * 约束（Round F-2 §11）：纯函数、无副作用、不请求 API、不访问 window / localStorage。
 * 数据由 Auth Store → Context 选择器提供，本层只做计算。
 *
 * 后端契约依据（Round F-0）：
 *   · GET /api/auth/profile → user.role.code / user.role.dataScope / user.permissions
 *   · 权限码为精确字符串（如 `customers`、`system:user:create`）；后端 requirePerm 为**精确匹配**
 *     （admin 由中间件直接放行）⇒ 前端同样只做精确匹配，不做前缀 / 通配符匹配。
 */

/** 数据范围默认值（后端 Role.dataScope 默认 SELF；未取到 role 时同样回落） */
export const DEFAULT_DATA_SCOPE: DataScope = 'SELF';

/** admin 身份**只**由 role.code 判定（不依赖 permissions 是否包含 '*'） */
export const isAdminUser = (user: CurrentUser | null | undefined): boolean => user?.role?.code === 'admin';

/** 读取权限码数组；任何异常形状都安全回落为空数组 */
export const getUserPermissions = (user: CurrentUser | null | undefined): PermissionCode[] =>
  Array.isArray(user?.permissions) ? user.permissions.filter((c): c is string => typeof c === 'string') : [];

/** 读取数据范围：仅接受后端定义的 ALL / DEPT / SELF，其余（含 undefined）回落 SELF */
export const getDataScope = (user: CurrentUser | null | undefined): DataScope => {
  const scope = user?.role?.dataScope;
  return scope === 'ALL' || scope === 'DEPT' || scope === 'SELF' ? scope : DEFAULT_DATA_SCOPE;
};

/**
 * 单权限判定（与后端 requirePerm 语义对齐）：
 *   未登录 → false · admin → true · 其他 → permissions 精确包含 code · 其余 → false
 */
export const hasPermission = (user: CurrentUser | null | undefined, code: string): boolean => {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return getUserPermissions(user).includes(code);
};

/**
 * 检测 profile 异常形状（Round F-2 §17）：仅记录，不打印敏感数据。
 * 返回缺失项描述数组；为空表示结构正常。
 */
export const detectProfileAnomalies = (user: CurrentUser | null | undefined): string[] => {
  if (!user) return ['user is null'];
  const issues: string[] = [];
  if (!user.role) issues.push('role is missing');
  else if (!user.role.code) issues.push('role.code is missing');
  if (!Array.isArray(user.permissions)) issues.push('permissions is not an array');
  if (user.role && (user.role.dataScope === undefined || user.role.dataScope === null)) {
    issues.push('role.dataScope is missing');
  }
  return issues;
};
