import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { DomainError } from '../lib/errors';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', err.message);

  // 业务层错误（Round R-1）：Business / Operation 层以 DomainError 表达业务失败，
  // 由本 HTTP 边界统一映射为状态码，领域层不得自行构造响应。
  // 纯新增分支：既有错误（ZodError / P2002 / 其他）行为不变。
  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({
      code: err.code,
      message: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
    });
    return;
  }

  // Zod 校验错误
  if (err instanceof ZodError) {
    res.status(400).json({
      code: 400,
      message: '参数校验失败',
      errors: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  // Prisma 唯一约束冲突
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    res.status(409).json({ code: 409, message: '数据已存在，请勿重复添加' });
    return;
  }

  res.status(500).json({
    code: 500,
    message: process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误',
  });
};
