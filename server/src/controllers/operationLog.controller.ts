import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { BUSINESS_TYPE_LABELS } from '../lib/business-type';
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

/**
 * GET /api/operation-logs
 *
 * 查询全局审计日志（V1.0 `OperationLog`）。
 *
 * 字段语义（V1.0）：
 *  - `businessType` / `businessId` / `businessNo` 业务对象定位
 *  - `summary` 人类可读摘要
 * 旧字段 `target` / `targetId` / `detail` 已废弃，不得再出现在查询与响应中。
 *
 * 支持：关键字（username / realName / summary / businessNo）、模块、动作、操作人、
 * 业务类型、业务对象 id、单据号、时间区间、分页与排序。
 */
export const getOperationLogs = async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt((req.query.pageSize as string) || '20', 10)),
    );
    const module = (req.query.module as string) || '';
    const action = (req.query.action as string) || '';
    const userId = (req.query.userId as string) || '';
    const keyword = (req.query.keyword as string) || '';
    const businessType = (req.query.businessType as string) || '';
    const businessId = (req.query.businessId as string) || '';
    const businessNo = (req.query.businessNo as string) || '';
    const start = (req.query.start as string) || '';
    const end = (req.query.end as string) || '';
    const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

    const where: Record<string, any> = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (businessType) where.businessType = businessType;
    if (businessId) where.businessId = businessId;
    if (businessNo) where.businessNo = { contains: businessNo };
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { realName: { contains: keyword } },
        { summary: { contains: keyword } },
        { businessNo: { contains: keyword } },
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
        orderBy: { createdAt: order },
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
      businessTypeLabels: BUSINESS_TYPE_LABELS,
    });
  } catch (e) {
    fail(res, 500, '查询操作日志失败');
  }
};
