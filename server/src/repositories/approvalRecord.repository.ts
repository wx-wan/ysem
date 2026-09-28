import type { ApprovalBizType, ApprovalStatus, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * ApprovalRecord（审批流水）数据访问 —— Round R-5 · Phase 4 · D3 审批域
 *
 * 【多态旁挂】ApprovalRecord 以 `bizType + businessId` 指向业务单据，**schema 无外键**。
 * 因此审批域读取业务对象时无法经 relation 追溯，必须在各业务域**自己的仓储**上取数
 * （见 `operations/approval.operations.ts` 的分派）；本仓储只负责审批记录自身。
 *
 * 只做持久化与查询；「谁能提交 / 谁能审批 / 状态是否允许流转」属 Business 层。
 */
const model = (db: DbClient) => (db as typeof prisma).approvalRecord;

export const approvalRecordRepository = {
  findMany<T extends Prisma.ApprovalRecordFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ApprovalRecordGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.ApprovalRecordFindManyArgs) as unknown as Promise<
      Prisma.ApprovalRecordGetPayload<T>[]
    >;
  },

  count(where: Prisma.ApprovalRecordWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  findById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id } });
  },

  /** 事务内「仅待审批可流转」判定所需的轻量读取 */
  findStatusById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { status: true } });
  },

  /** 防重复：同一业务单据是否已存在 PENDING（并发最终断言由 DB partial unique index 承担） */
  findPending(bizType: ApprovalBizType, businessId: string, db: DbClient = prisma) {
    return model(db).findFirst({
      where: { bizType, businessId, status: 'PENDING' as ApprovalStatus },
      select: { id: true },
    });
  },

  create(data: Prisma.ApprovalRecordUncheckedCreateInput, db: DbClient = prisma) {
    return model(db).create({ data });
  },

  updateStatus(
    id: string,
    data: Prisma.ApprovalRecordUncheckedUpdateInput,
    db: DbClient = prisma,
  ) {
    return model(db).update({ where: { id }, data });
  },
};
