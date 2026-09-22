/**
 * 认证相关类型 —— 字段严格依据 Round F-0 审计出的真实后端契约，未新增任何数据库不存在的字段。
 *
 * 依据：
 *   · POST /api/auth/login   → data = { accessToken, refreshToken, expiresIn, user }
 *   · POST /api/auth/refresh → data = { accessToken, refreshToken, expiresIn }（**不含 user/permissions**）
 *   · GET  /api/auth/profile → data = { ...user, permissions }（**CurrentUser 的唯一权威来源**）
 */

/** 数据范围档位（Role.dataScope） */
export type DataScope = 'ALL' | 'DEPT' | 'SELF';

/** 权限码（如 `customers`、`system:user:create`）；admin 登录/profile 时返回 ['*'] */
export type PermissionCode = string;

/** 角色（Prisma Role 行；profile 的 role 额外内嵌 permissions） */
export interface Role {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  status?: number;
  sort?: number;
  dataScope?: DataScope;
  createdAt?: string;
  updatedAt?: string;
}

/** 权限点（profile.role.permissions[].permission） */
export interface Permission {
  id: string;
  name: string;
  code: string;
  type?: string;
  parentId?: string | null;
  sort?: number;
  path?: string | null;
  icon?: string | null;
}

/** profile.role.permissions 的元素（RolePermission 关系包装） */
export interface RolePermissionEntry {
  permission: Permission;
}

/** profile 返回的角色（含 permissions 关联） */
export interface ProfileRole extends Role {
  permissions?: RolePermissionEntry[];
}

/** 部门（Prisma Department 行） */
export interface Department {
  id: string;
  name: string;
  code?: string;
  parentId?: string | null;
  leaderId?: string | null;
  phone?: string | null;
  email?: string | null;
  sort?: number;
  status?: number;
  createdAt?: string;
  updatedAt?: string;
}

// ========== 请求 / 响应 ==========

export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * 登录响应的 user —— **精简形状**，与 profile 不同：
 *   · 无 status / lastLoginAt / createdAt
 *   · role 为普通 Role 行（不含 permissions 关联）
 *   · 归属为 departmentId（字符串），而非 department 对象
 * 因此**不得**把它当作最终 CurrentUser 模型。
 */
export interface LoginUser {
  id: string;
  username: string;
  realName: string;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  role: Role | null;
  departmentId?: string | null;
  /** admin → ['*']；其他 → 权限码数组 */
  permissions: PermissionCode[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  /** accessToken 有效期（秒） */
  expiresIn: number;
  user: LoginUser;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** GET /api/auth/profile 的 data —— 前端 Current User 的唯一权威来源 */
export interface CurrentUser {
  id: string;
  username: string;
  realName: string;
  email?: string | null;
  phone?: string | null;
  avatar?: string | null;
  status?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
  role: ProfileRole | null;
  department?: Department | null;
  /** admin → ['*']；其他 → 权限码数组 */
  permissions: PermissionCode[];
}

export interface LogoutRequest {
  /** 传入则只登出该端；不传则清空该用户全部 refreshTokens */
  refreshToken?: string;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
