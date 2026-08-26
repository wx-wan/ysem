import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest, JwtPayload } from '../middleware/auth';
import { success, fail } from '../utils/response';

// 校验 schema
const loginSchema = z.object({
  username: z.string().min(1, '用户名不能为空'),
  password: z.string().min(1, '密码不能为空'),
});

const registerSchema = z.object({
  username: z.string().min(2).max(50),
  password: z.string().min(6).max(100),
  realName: z.string().min(1).max(50),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

// 将 '30s' / '24h' / '7d' / '15m' 等格式解析为秒数
const parseExpiresInToSeconds = (value: string): number => {
  const match = /^(\d+)\s*(s|m|h|d)$/i.exec(value.trim());
  if (!match) return 86400; // 兜底 24h
  const n = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const map: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * map[unit];
};

// 生成 token
const generateTokens = (payload: JwtPayload) => {
  const accessExpiresIn = process.env.JWT_EXPIRES_IN || '24h';
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET!, {
    expiresIn: accessExpiresIn as jwt.SignOptions['expiresIn'],
  });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'],
  });
  return { accessToken, refreshToken, expiresIn: parseExpiresInToSeconds(accessExpiresIn) };
};

// 登录
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { username },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user) {
      fail(res, 401, '用户名或密码错误');
      return;
    }

    if (user.status === 'DISABLED') {
      fail(res, 403, '账号已被禁用');
      return;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      fail(res, 401, '用户名或密码错误');
      return;
    }

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      roleCode: user.role?.code || 'user',
    };

    const tokens = generateTokens(payload);

    // 计算权限 code 列表
    const permissions =
      user.role?.code === 'admin'
        ? ['*']
        : user.role?.permissions.map((rp) => rp.permission.code) ?? [];

    // 保存 refreshToken（多值列表，支持多端/多标签页同时在线，最多保留最近 10 个）
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokens: { set: [...(user.refreshTokens ?? []), tokens.refreshToken].slice(-10) },
        lastLoginAt: new Date(),
      },
    });

    // 记录登录日志
    await prisma.loginLog.create({
      data: {
        userId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
      },
    });

    success(res, {
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
        permissions,
      },
    }, '登录成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// 注册
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const data = registerSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({ where: { username: data.username } });
    if (existingUser) {
      fail(res, 409, '用户名已存在');
      return;
    }

    const hashedPassword = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
      },
      select: { id: true, username: true, realName: true, email: true, createdAt: true },
    });

    success(res, user, '注册成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, '参数校验失败：' + err.errors.map(e => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
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

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

    if (!user || !user.refreshTokens.includes(token)) {
      fail(res, 401, 'refreshToken 无效');
      return;
    }

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      roleCode: decoded.roleCode,
    };

    const tokens = generateTokens(payload);
    // 轮换：移除当前 token、追加新 token（上限 10），不影响其他端在线
    const next = user.refreshTokens.filter((t) => t !== token).concat(tokens.refreshToken).slice(-10);
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokens: { set: next } },
    });

    success(res, { ...tokens, expiresIn: tokens.expiresIn }, 'Token 刷新成功');
  } catch {
    fail(res, 401, 'refreshToken 无效或已过期');
  }
};

// 登出（携带 refreshToken 时只移除当前端，未携带则清空全部登录态）
export const logout = async (req: AuthRequest, res: Response): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (user) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokens: refreshToken
          ? { set: user.refreshTokens.filter((t) => t !== refreshToken) }
          : { set: [] },
      },
    });
  }
  success(res, null, '登出成功');
};

// 获取当前用户信息
export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true, username: true, realName: true, email: true, phone: true,
      avatar: true, status: true, lastLoginAt: true, createdAt: true,
      role: { include: { permissions: { include: { permission: true } } } },
      department: true,
    },
  });

  if (!user) {
    fail(res, 404, '用户不存在');
    return;
  }

  const permissions =
    user.role?.code === 'admin'
      ? ['*']
      : user.role?.permissions.map((rp) => rp.permission.code) ?? [];

  success(res, { ...user, permissions });
};

// 修改密码
export const changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      fail(res, 400, '请提供旧密码和新密码');
      return;
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      fail(res, 404, '用户不存在');
      return;
    }

    const isValid = await bcrypt.compare(oldPassword, user.password);
    if (!isValid) {
      fail(res, 400, '旧密码错误');
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.userId },
      // 修改密码后清除所有端登录态，强制重新登录
      data: { password: hashedPassword, refreshTokens: { set: [] } },
    });

    success(res, null, '密码修改成功，请重新登录');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
