import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
  roleCode?: string;
  userPermissions?: string[];
}

export interface JwtPayload {
  userId: string;
  username: string;
  roleCode: string;
}

// 验证 JWT Token
export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: '未提供认证令牌' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
    req.userId = decoded.userId;
    req.username = decoded.username;
    req.roleCode = decoded.roleCode;
    // 解析当前用户的权限 code 列表（admin 视为拥有全部权限，由 requirePerm 放行）
    if (decoded.roleCode !== 'admin') {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
      req.userPermissions = user?.role?.permissions.map((rp) => rp.permission.code) ?? [];
    }
    next();
  } catch {
    res.status(401).json({ code: 401, message: '认证令牌无效或已过期' });
  }
};

// 角色权限校验（粗粒度，保留兼容）
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.roleCode || !roles.includes(req.roleCode)) {
      res.status(403).json({ code: 403, message: '权限不足' });
      return;
    }
    next();
  };
};

// 基于权限 code 的细粒度鉴权（admin 角色自动放行）
export const requirePerm = (...codes: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (req.roleCode === 'admin') return next();
    const owned = req.userPermissions ?? [];
    const ok = codes.some((c) => owned.includes(c));
    if (!ok) {
      res.status(403).json({ code: 403, message: '权限不足' });
      return;
    }
    next();
  };
};
