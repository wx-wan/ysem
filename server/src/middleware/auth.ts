import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  username?: string;
  roleCode?: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  roleCode: string;
}

// 验证 JWT Token
export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
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
    next();
  } catch {
    res.status(401).json({ code: 401, message: '认证令牌无效或已过期' });
  }
};

// 角色权限校验
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.roleCode || !roles.includes(req.roleCode)) {
      res.status(403).json({ code: 403, message: '权限不足' });
      return;
    }
    next();
  };
};
