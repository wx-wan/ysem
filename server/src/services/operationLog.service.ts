import type { Prisma } from '@prisma/client';
import { BUSINESS_TYPE_LABELS } from '../lib/business-type';
import { operationLogRepository } from '../repositories';

/**
 * OperationLog Business Layer（审计查询）—— Round R-5 · Phase 4 · D4-b
 *
 * V1.0 `OperationLog` 是全局审计时间线（**只读查询**）：
 *  - `businessType` / `businessId` / `businessNo` 业务对象定位；`summary` 人类可读摘要
 *  - 旧字段 `target` / `targetId` / `detail` 已废弃，**不得**再出现在查询与响应中
 *
 * 本层负责：查询参数归一化、过滤条件组装、分页夹取、标签字典。
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

/** 模块中文名（响应契约的一部分） */
export const MODULE_LABELS: Record<string, string> = {
  product: '产品',
  customer: '客户',
  sales: '商机',
  order: '订单',
  user: '用户',
  certificate: '资质',
};

/** 动作中文名（响应契约的一部分） */
export const ACTION_LABELS: Record<string, string> = {
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

export interface OperationLogQuery {
  page?: string;
  pageSize?: string;
  module?: string;
  action?: string;
  userId?: string;
  keyword?: string;
  businessType?: string;
  businessId?: string;
  businessNo?: string;
  start?: string;
  end?: string;
  order?: string;
}

/**
 * 审计日志查询。
 *
 * 归一化口径逐字沿用：
 *  · `page` ≥ 1（缺省 1）；`pageSize` ∈ [1,100]（缺省 20）
 *  · `order` 仅 `asc` 为升序，其余一律降序
 *  · `businessNo` 为模糊匹配；`keyword` 命中 username / realName / summary / businessNo
 *  · 时间区间：`start` 直接解析；`end` 补齐为当日 23:59:59
 */
export async function list(query: OperationLogQuery) {
  const page = Math.max(1, parseInt(query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize || '20', 10)));
  const order = query.order === 'asc' ? 'asc' : 'desc';

  const where: Prisma.OperationLogWhereInput = {};
  if (query.module) where.module = query.module;
  if (query.action) where.action = query.action;
  if (query.userId) where.userId = query.userId;
  if (query.businessType) where.businessType = query.businessType;
  if (query.businessId) where.businessId = query.businessId;
  if (query.businessNo) where.businessNo = { contains: query.businessNo };
  if (query.keyword) {
    where.OR = [
      { username: { contains: query.keyword } },
      { realName: { contains: query.keyword } },
      { summary: { contains: query.keyword } },
      { businessNo: { contains: query.keyword } },
    ];
  }
  if (query.start || query.end) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.start) createdAt.gte = new Date(query.start);
    if (query.end) createdAt.lte = new Date(query.end + 'T23:59:59');
    where.createdAt = createdAt;
  }

  const [total, list] = await Promise.all([
    operationLogRepository.count(where),
    operationLogRepository.findMany({
      where,
      orderBy: { createdAt: order },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    list,
    total,
    page,
    pageSize,
    moduleLabels: MODULE_LABELS,
    actionLabels: ACTION_LABELS,
    businessTypeLabels: BUSINESS_TYPE_LABELS,
  };
}
