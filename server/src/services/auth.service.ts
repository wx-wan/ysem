import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  DomainConflictError,
  DomainError,
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
} from '../lib/errors';
import { loginLogRepository, userRepository } from '../repositories';

/**
 * Auth Business Layer —— Round R-5 · Phase 4 · D4-b 认证与会话 / 审计域
 *
 * ⚠️ **本域为安全边界**：token 签发 / 刷新轮换 / 会话失效 / 凭据校验。
 * 本轮为**纯结构迁移**：算法、密钥来源、TTL、轮换上限、错误文案与状态码**全部逐字保留**，
 * **未做任何安全策略变更**（未加锁、未加限流、未改哈希代价、未改 token 结构）。
 *
 * 【Layering 说明】
 *   · `JwtPayload` 本层**重新声明**为本地 `AuthTokenPayload`（结构等价），
 *     以**避免 services → middleware 的反向依赖**（middleware 属共享层，不应被业务层依赖）。
 *   · `jwt` / `bcrypt` 为库依赖（非 HTTP、非 DB），故可留在 Business；
 *     **不引入 lib 抽象**（当前仅此一处消费，避免为形式制造间接层）。
 *   · Prisma 访问一律经 `repositories/`，本层不直接 import Prisma 单例。
 *
 * 【无 Operation 层】本域**零事务**（迁移前登录的两处写入亦未包事务），
 * 按 Master Plan §13 不制造空壳 Operation。
 */

// ============================================================
// DTO
// ============================================================

export const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(100),
  realName: z.string().min(1).max(50),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

/** JWT 载荷（与 `middleware/auth.JwtPayload` 结构等价；本层不反向依赖 middleware） */
export interface AuthTokenPayload {
  userId: string;
  username: string;
  realName?: string;
  roleCode: string;
}

/** bcrypt 代价因子（既有实现：12） */
const BCRYPT_ROUNDS = 12;

/** 多端在线：refreshToken 保留上限（既有实现：10） */
const MAX_REFRESH_TOKENS = 10;

/** 内置管理员角色码：权限清单以通配符 `*` 表达 */
const ADMIN_ROLE_CODE = 'admin';

// ============================================================
// Token 工具（逐字保留）
// ============================================================

/** 将 '30s' / '24h' / '7d' / '15m' 等格式解析为秒数 */
export const parseExpiresInToSeconds = (value: string): number => {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(value.trim());
  if (!match) return 86400; // 兜底 24h
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const map: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * map[unit];
};

/**
 * 生成 access / refresh token。
 * 密钥与 TTL 一律取自环境变量（未提供任何默认密钥 —— 缺失即按既有行为由 jwt 抛错）。
 */
export const generateTokens = (payload: AuthTokenPayload) => {
  const accessExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: accessExpiresIn as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
  return { accessToken, refreshToken, expiresIn: parseExpiresInToSeconds(accessExpiresIn) };
};

/** 权限 code 清单：admin 角色 → `['*']`；否则取角色权限明细的 code（无角色 → 空数组） */
function resolvePermissionCodes(
  role: { code: string; permissions: Array<{ permission: { code: string } }> } | null | undefined,
): string[] {
  return role?.code === ADMIN_ROLE_CODE ? ['*'] : role?.permissions.map((rp) => rp.permission.code) ?? [];
}

// ============================================================
// 登录 / 注册
// ============================================================

/** 登录（凭据校验 → 签发 token → 记录登录态与登录日志） */
export async function login(input: LoginInput, meta: { ip?: string; userAgent?: string }) {
  const user = await userRepository.findByUsernameWithAuthz(input.username);

  if (!user) throw new DomainError('用户名或密码错误', { httpStatus: 401 });
  // 禁用检查先于密码比对（既有顺序：不向被禁用账号泄露密码是否正确）
  if (user.status === 'DISABLED') throw new DomainForbiddenError('账号已被禁用');

  const isPasswordValid = await bcrypt.compare(input.password, user.password);
  if (!isPasswordValid) throw new DomainError('用户名或密码错误', { httpStatus: 401 });

  const tokens = generateTokens({
    userId: user.id,
    username: user.username,
    realName: user.realName,
    roleCode: user.role?.code || 'user',
  });

  // 保存 refreshToken（多值列表，支持多端 / 多标签页同时在线，最多保留最近 10 个）
  await userRepository.setRefreshTokensAndLastLogin(
    user.id,
    [...(user.refreshTokens ?? []), tokens.refreshToken].slice(-MAX_REFRESH_TOKENS),
    new Date(),
  );

  // 记录登录日志
  await loginLogRepository.create({
    userId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
    success: true,
  });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    user: {
      id: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role,
      departmentId: user.departmentId,
      permissions: resolvePermissionCodes(user.role),
    },
  };
}

/** 公开注册（用户名唯一；密码以 bcrypt 存储） */
export async function register(input: RegisterInput) {
  const existingUser = await userRepository.findIdByUsername(input.username);
  if (existingUser) throw new DomainConflictError('用户名已存在');

  const hashedPassword = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return userRepository.createFromRegister({
    username: input.username,
    password: hashedPassword,
    realName: input.realName,
    email: input.email,
    phone: input.phone,
  });
}

// ============================================================
// 刷新 / 登出 / 资料 / 改密
// ============================================================

/**
 * 刷新 token（轮换：移除当前 token、追加新 token（上限 10），不影响其他端在线）。
 *
 * 错误语义（与迁移前逐字一致）：
 *   · 签名/过期校验失败 → `refreshToken 无效或已过期`（401）
 *   · token 不在该用户的有效列表中 → `refreshToken 无效`（401）
 */
export async function refresh(token: string) {
  let decoded: AuthTokenPayload;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as AuthTokenPayload;
  } catch {
    throw new DomainError('refreshToken 无效或已过期', { httpStatus: 401 });
  }

  const user = await userRepository.findByIdForRefresh(decoded.userId);
  if (!user || !user.refreshTokens.includes(token)) {
    throw new DomainError('refreshToken 无效', { httpStatus: 401 });
  }

  const tokens = generateTokens({
    userId: user.id,
    username: user.username,
    roleCode: decoded.roleCode,
  });

  const next = user.refreshTokens
    .filter((t) => t !== token)
    .concat(tokens.refreshToken)
    .slice(-MAX_REFRESH_TOKENS);
  await userRepository.setRefreshTokens(user.id, next);

  return tokens;
}

/**
 * 登出。
 * 携带 refreshToken 时只移除当前端；未携带则清空全部登录态。
 */
export async function logout(userId: string, refreshToken?: string): Promise<void> {
  const user = await userRepository.findByIdWithRefreshTokens(userId);
  if (user) {
    await userRepository.setRefreshTokens(
      user.id,
      refreshToken ? user.refreshTokens.filter((t) => t !== refreshToken) : [],
    );
  }
}

/** 当前用户资料（含角色 / 权限 / 部门；权限清单附带 `permissions` 派生字段） */
export async function getProfile(userId: string) {
  const user = await userRepository.findProfileById(userId);
  if (!user) throw new DomainNotFoundError('用户不存在');
  return { ...user, permissions: resolvePermissionCodes(user.role) };
}

/**
 * 修改密码（校验旧密码 → 写入新哈希 → **清空全部端登录态**，强制重新登录）。
 */
export async function changePassword(
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await userRepository.findByIdWithPassword(userId);
  if (!user) throw new DomainNotFoundError('用户不存在');

  const isValid = await bcrypt.compare(oldPassword, user.password);
  if (!isValid) throw new DomainValidationError('旧密码错误');

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userRepository.setPasswordAndClearTokens(userId, hashedPassword);
}
