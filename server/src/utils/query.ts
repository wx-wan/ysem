import type { Prisma } from '@prisma/client';

export interface PaginateOptions {
  page?: number | string;
  pageSize?: number | string;
  orderBy?: Prisma.InputJsonValue | Prisma.InputJsonValue[];
  include?: Prisma.InputJsonValue;
  select?: Prisma.InputJsonValue;
}

export interface PaginateResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 统一的列表分页查询方法。
 *
 * 所有业务列表（客户、线索、订单、销售机会等）都通过本方法发起查询，
 * 避免在各控制器中重复编写 findMany + count 的样板代码。
 *
 * 数据范围（当前用户可见范围）由调用方在传入的 where 中通过
 * `ownerScope` / `applyScope`（见 utils/scope.ts）合并，本方法只负责
 * 分页、排序与返回结构统一。
 */
export async function paginateList<T = unknown>(
  delegate: any,
  where: Record<string, unknown>,
  options: PaginateOptions = {},
): Promise<PaginateResult<T>> {
  const page = Math.max(1, Number(options.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));

  const [list, total] = await Promise.all([
    delegate.findMany({
      where,
      include: options.include,
      select: options.select,
      orderBy: options.orderBy ?? [{ createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    delegate.count({ where }),
  ]);

  return { list, total, page, pageSize };
}
