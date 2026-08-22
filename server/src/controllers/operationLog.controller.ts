import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { success, fail } from '../utils/response';

// 模块中文名
const MODULE_LABELS: Record<string, string> = {
  product: '产品',
  customer: '客户',
  sales: '商机',
  order: '订单',
  user: '用户',
  certificate: '资质',
};

// 动作中文名
const ACTION_LABELS: Record<string, string> = {
  CREATE: '创建',
  UPDATE: '修改',
  DELETE: '删除',
  STATUS: '状态变更',
  STAGE: '阶段变更',
  CLAIM: '认领',
  RELEASE: '释放',
  LOGIN: '登录',
  AUTH: '授权',
  EXPORT: '导出',
};

export const getOperationLogs = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) || '20', 10)));
    const module = (req.query.module as string) || '';
    const action = (req.query.action as string) || '';
    const userId = (req.query.userId as string) || '';
    const keyword = (req.query.keyword as string) || '';
    const start = (req.query.start as string) || '';
    const end = (req.query.end as string) || '';

    const where: any = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { realName: { contains: keyword } },
        { detail: { contains: keyword } },
        { target: { contains: keyword } },
      ];
    }
    if (start || end) {
      where.createdAt = {};
      if (start) where.createdAt.gte = new Date(start);
      if (end) where.createdAt.lte = new Date(end + 'T23:59:59');
    }

    const [total, list] = await Promise.all([
      prisma.operationLog.count({ where }),
      prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    success(res, {
      list,
      total,
      page,
      pageSize,
      moduleLabels: MODULE_LABELS,
      actionLabels: ACTION_LABELS,
    });
  } catch (e) {
    fail(res, 500, '查询操作日志失败');
  }
};
