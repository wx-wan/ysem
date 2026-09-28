import type { ApprovalBizType, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * ApprovalConfig（审批配置）数据访问 —— Round R-5 · Phase 4 · D3 审批域
 *
 * 归属：Data Layer。`bizType` 为 **@unique**（每个业务类型最多一条配置），
 * 因此本仓储以 `bizType` 而非 `id` 作为主查询键（沿用既有语义）。
 *
 * 只做持久化与查询；「审批人是否合法 / flow 如何解释 / 能否重复创建」属 Business 层。
 */
const model = (db: DbClient) => (db as typeof prisma).approvalConfig;

export const approvalConfigRepository = {
  /** 全部配置（bizType 升序，既有排序口径） */
  findAll(db: DbClient = prisma) {
    return model(db).findMany({ orderBy: { bizType: 'asc' } });
  },

  /** 按业务类型取配置（详情 / 存在性 / 审批人解析共用） */
  findByBizType(bizType: ApprovalBizType, db: DbClient = prisma) {
    return model(db).findUnique({ where: { bizType } });
  },

  create(data: Prisma.ApprovalConfigUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  updateByBizType(bizType: ApprovalBizType, data: Prisma.ApprovalConfigUncheckedUpdateInput, db: DbClient = prisma) {
    return model(db).update({ where: { bizType }, data });
  },

  deleteByBizType(bizType: ApprovalBizType, db: DbClient = prisma) {
    return model(db).delete({ where: { bizType } });
  },
};
