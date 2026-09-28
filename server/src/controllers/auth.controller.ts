import { Request, Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as authService from '../services/auth.service';
import { fail, success } from '../utils/response';

/**
 * Auth Controller —— Round R-5 · Phase 4 · D4-b 认证与会话 / 审计域
 *
 * ⚠️ **安全边界**。本轮为**纯结构迁移**：路由、状态码、错误文案、响应体形状逐字保留，
 * **未做任何安全策略变更**。
 *
 * 职责（仅此）：HTTP request/response、DTO 校验、错误映射。
 * **禁止** Prisma 访问 / JWT 签发 / bcrypt —— 已在 `services/auth.service.ts`（Business）
 * / `repositories/*`（Data）。**无 Operation 层**（本域零事务）。
 */

/** 通用错误映射：Zod → 400（带既有前缀）；领域错误 → 其建议状态码；其余 → 500 */
function respondError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    fail(res, 400, '参数校验失败：' + err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// 登录
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = authService.loginSchema.parse(req.body);
    success(
      res,
      await authService.login(input, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      }),
      '登录成功',
    );
  } catch (err) {
    respondError(res, err);
  }
};

// 注册
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const input = authService.registerSchema.parse(req.body);
    success(res, await authService.register(input), '注册成功');
  } catch (err) {
    respondError(res, err);
  }
};

// 刷新 Token
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      fail(res, 400, '请提供 refreshToken');
      return;
    }
    const tokens = await authService.refresh(token);
    success(res, { ...tokens, expiresIn: tokens.expiresIn }, 'Token 刷新成功');
  } catch (err) {
    if (err instanceof DomainError) {
      fail(res, err.code, err.message);
      return;
    }
    // 既有契约：本端点的**任何**非领域异常一律 401「refreshToken 无效或已过期」
    fail(res, 401, 'refreshToken 无效或已过期');
  }
};

// 登出（携带 refreshToken 时只移除当前端，未携带则清空全部登录态）
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  await authService.logout(req.userId as string, refreshToken);
  success(res, null, '登出成功');
};

// 获取当前用户信息
export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await authService.getProfile(req.userId as string));
  } catch (err) {
    if (err instanceof DomainError) {
      fail(res, err.code, err.message);
      return;
    }
    // 与迁移前一致：非领域错误交由 Express 错误中间件
    throw err;
  }
};

// 修改密码
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      fail(res, 400, '请提供旧密码和新密码');
      return;
    }
    await authService.changePassword(req.userId as string, oldPassword, newPassword);
    success(res, null, '密码修改成功，请重新登录');
  } catch (err) {
    if (err instanceof DomainError) {
      fail(res, err.code, err.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
