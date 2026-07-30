import { Response } from 'express';

interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data?: T;
}

export const success = <T>(res: Response, data: T, message = '操作成功'): void => {
  res.json({ code: 200, message, data });
};

export const created = <T>(res: Response, data: T, message = '创建成功'): void => {
  res.status(201).json({ code: 201, message, data });
};

export const fail = (res: Response, code: number, message: string): void => {
  res.status(code).json({ code, message });
};
