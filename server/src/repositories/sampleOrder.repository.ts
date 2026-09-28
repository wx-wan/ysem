import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * SampleOrder 数据访问（Data Layer）
 *
 * 两种角色：
 *   ① **SampleOrder 业务域的权威访问**（Round R-5 · Phase 1 Sales Process Domain 扩充），
 *      含 SampleRound 子表的写入；
 *   ② **Customer 报表读模型**（Round R-3 建立，`count` 语义与签名保持不变）。
 *
 * 约束：只做持久化与查询；轮次编号规则、currentRound 重算口径由 Operation 层执行。
 */

const sampleOrderModel = (db: DbClient) => (db as typeof prisma).sampleOrder;
const sampleRoundModel = (db: DbClient) => (db as typeof prisma).sampleRound;

export const sampleOrderRepository = {
  // ============================================================
  // ① Customer 报表读模型（R-3 建立，语义不变）
  // ============================================================

  /** 打样单总数（客户报表「下打样单」阶段计数） */
  count(db: DbClient = prisma) {
    return db.sampleOrder.count();
  },

  // ============================================================
  // ② SampleOrder 属主访问（Round R-5 · Phase 1）
  // ============================================================

  findMany<T extends Prisma.SampleOrderFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleOrderGetPayload<T>[]> {
    return sampleOrderModel(db).findMany(args as Prisma.SampleOrderFindManyArgs) as unknown as Promise<
      Prisma.SampleOrderGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.SampleOrderFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleOrderGetPayload<T> | null> {
    return sampleOrderModel(db).findFirst(args as Prisma.SampleOrderFindFirstArgs) as unknown as Promise<
      Prisma.SampleOrderGetPayload<T> | null
    >;
  },

  countWhere(where?: Prisma.SampleOrderWhereInput, db: DbClient = prisma): Promise<number> {
    return sampleOrderModel(db).count(where ? { where } : undefined);
  },

  create<T extends Prisma.SampleOrderCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleOrderGetPayload<T>> {
    return sampleOrderModel(db).create(args as Prisma.SampleOrderCreateArgs) as unknown as Promise<
      Prisma.SampleOrderGetPayload<T>
    >;
  },

  update<T extends Prisma.SampleOrderUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleOrderGetPayload<T>> {
    return sampleOrderModel(db).update(args as Prisma.SampleOrderUpdateArgs) as unknown as Promise<
      Prisma.SampleOrderGetPayload<T>
    >;
  },

  delete<T extends Prisma.SampleOrderDeleteArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleOrderGetPayload<T>> {
    return sampleOrderModel(db).delete(args as Prisma.SampleOrderDeleteArgs) as unknown as Promise<
      Prisma.SampleOrderGetPayload<T>
    >;
  },

  /** 打样轮次：列表（roundNo 升序） */
  findRounds(sampleOrderId: string, db: DbClient = prisma) {
    return sampleRoundModel(db).findMany({ where: { sampleOrderId }, orderBy: { roundNo: 'asc' } });
  },

  /** 打样轮次：单条（限定所属打样单，杜绝跨单访问） */
  findRoundInOrder(roundId: string, sampleOrderId: string, db: DbClient = prisma) {
    return sampleRoundModel(db).findFirst({
      where: { id: roundId, sampleOrderId },
      select: { id: true, roundNo: true },
    });
  },

  /** 打样轮次：当前最大轮次号（无轮次时为 null） */
  async maxRoundNo(sampleOrderId: string, db: DbClient = prisma): Promise<number | null> {
    const max = await sampleRoundModel(db).aggregate({
      where: { sampleOrderId },
      _max: { roundNo: true },
    });
    return max._max.roundNo ?? null;
  },

  createRound<T extends Prisma.SampleRoundCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleRoundGetPayload<T>> {
    return sampleRoundModel(db).create(args as Prisma.SampleRoundCreateArgs) as unknown as Promise<
      Prisma.SampleRoundGetPayload<T>
    >;
  },

  updateRound<T extends Prisma.SampleRoundUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.SampleRoundGetPayload<T>> {
    return sampleRoundModel(db).update(args as Prisma.SampleRoundUpdateArgs) as unknown as Promise<
      Prisma.SampleRoundGetPayload<T>
    >;
  },

  deleteRound(id: string, db: DbClient = prisma) {
    return sampleRoundModel(db).delete({ where: { id } });
  },

  /** 明细快照的产品批量读取（授权条件由调用方给出） */
  findVisibleProduct(
    productId: string,
    visibilityWhere: Prisma.ProductWhereInput = {},
    db: DbClient = prisma,
  ) {
    return db.product.findFirst({
      where: { id: productId, ...visibilityWhere },
      select: { id: true, name: true, packaging: true },
    });
  },
};
