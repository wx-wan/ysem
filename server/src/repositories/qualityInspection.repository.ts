import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * QualityInspection 数据访问 —— Round R-5 · Phase 4 · D1-b 生产质量域
 *
 * 归属：Data Layer。只做持久化与查询。
 *  · 「exactly-one owner（生产工单 XOR 出运单）」「宿主存在性」「结论 append-only」
 *    一律属 Business（`services/qualityInspection.service.ts`）；
 *  · Scope 条件由 Business 组装后传入。
 */
const model = (db: DbClient) => (db as typeof prisma).qualityInspection;

export const qualityInspectionRepository = {
  findMany<T extends Prisma.QualityInspectionFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QualityInspectionGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.QualityInspectionFindManyArgs) as unknown as Promise<
      Prisma.QualityInspectionGetPayload<T>[]
    >;
  },

  findFirst<T extends Prisma.QualityInspectionFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QualityInspectionGetPayload<T> | null> {
    return model(db).findFirst(args as Prisma.QualityInspectionFindFirstArgs) as unknown as Promise<
      Prisma.QualityInspectionGetPayload<T> | null
    >;
  },

  count(where: Prisma.QualityInspectionWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  create<T extends Prisma.QualityInspectionCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QualityInspectionGetPayload<T>> {
    return model(db).create(args as Prisma.QualityInspectionCreateArgs) as unknown as Promise<
      Prisma.QualityInspectionGetPayload<T>
    >;
  },

  update<T extends Prisma.QualityInspectionUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.QualityInspectionGetPayload<T>> {
    return model(db).update(args as Prisma.QualityInspectionUpdateArgs) as unknown as Promise<
      Prisma.QualityInspectionGetPayload<T>
    >;
  },

  /**
   * C-2 · 出运前「最新一条」PRE_SHIPMENT 质检单（判定在 Business）。
   *
   * 排序键 `createdAt DESC, id DESC`：`createdAt` 非空且创建后不可变；
   * `id` 为非空唯一值（确定性并列键）。`inspectionDate` 可空、`updatedAt` 可被改写
   * —— **均不得**用作排序键。
   */
  findLatestPreShipment(shipmentId: string, type: string, db: DbClient = prisma) {
    return model(db).findFirst({
      where: { shipmentId, type: type as never },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { inspectionNo: true, result: true },
    });
  },

};
