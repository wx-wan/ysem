import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { applyScope } from '../utils/scope';
import type { DbClient } from './types';

/**
 * Shipment 数据访问（Data Layer）
 *
 * 【Round R-5 · Phase 4 · D3 审批域 建最小面】多态审批引用读取（只读）。
 * 【演进约定（R-5.2 · D15）】D1 履约域迁移时就地扩展本仓储，不新建平行仓储。
 *
 * 注意：Shipment **自身无 ownerId**，数据范围经 `salesOrder` 关系继承
 * （scope 条件由调用方按 relation 组装后传入）。
 */
const model = (db: DbClient) => (db as typeof prisma).shipment;

export const shipmentRepository = {
  /** 审批引用：主键 + 业务编号 */
  findRefById(id: string, db: DbClient = prisma) {
    return model(db).findUnique({ where: { id }, select: { id: true, shipmentNo: true } });
  },

  /** 审批 Scope 白名单（scope 由调用方按 relation 组装，如 `{ salesOrder: ownerScope }`） */
  findScopedIds(scope: Record<string, unknown>, id?: string, db: DbClient = prisma) {
    return model(db).findMany({
      where: applyScope(id ? { id } : {}, scope) as Prisma.ShipmentWhereInput,
      select: { id: true },
    });
  },

  /**
   * （Round R-5 · Phase 4 · D2 财务域）运费归集读取（ADR-20）。
   * Profit.freightCostCny = Σ Shipment.freightAmountCny（WHERE salesOrderId = X）；
   * 只取数据，求和与「无有效运费 → 0」口径由 Operation 层执行。
   */
  findFreightBySalesOrderId(salesOrderId: string, db: DbClient = prisma) {
    return model(db).findMany({ where: { salesOrderId }, select: { freightAmountCny: true } });
  },

  /**
   * （Round R-5 · Phase 4 · D1-b）宿主 scope 校验 / 详情读取。
   * Shipment 无 ownerId 列 —— 归属经 `salesOrder` relation 继承，条件由调用方组装。
   */
  findFirst<T extends Prisma.ShipmentFindFirstArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ShipmentGetPayload<T> | null> {
    return model(db).findFirst(args as Prisma.ShipmentFindFirstArgs) as unknown as Promise<
      Prisma.ShipmentGetPayload<T> | null
    >;
  },


  // ============================================================
  // Round R-5 · Phase 4 · D1-c 出运域：属主 CRUD + 明细重建支撑
  // ============================================================

  findMany<T extends Prisma.ShipmentFindManyArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ShipmentGetPayload<T>[]> {
    return model(db).findMany(args as Prisma.ShipmentFindManyArgs) as unknown as Promise<
      Prisma.ShipmentGetPayload<T>[]
    >;
  },

  count(where: Prisma.ShipmentWhereInput, db: DbClient = prisma): Promise<number> {
    return model(db).count({ where });
  },

  create<T extends Prisma.ShipmentCreateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ShipmentGetPayload<T>> {
    return model(db).create(args as Prisma.ShipmentCreateArgs) as unknown as Promise<
      Prisma.ShipmentGetPayload<T>
    >;
  },

  update<T extends Prisma.ShipmentUpdateArgs>(
    args: T,
    db: DbClient = prisma,
  ): Promise<Prisma.ShipmentGetPayload<T>> {
    return model(db).update(args as Prisma.ShipmentUpdateArgs) as unknown as Promise<
      Prisma.ShipmentGetPayload<T>
    >;
  },

  /** 本单既有明细（`quantity` 供 C-3 门禁取「本单最终量」） */
  findItemsByShipmentId(shipmentId: string, db: DbClient = prisma) {
    return (db as typeof prisma).shipmentItem.findMany({
      where: { shipmentId },
      select: { salesOrderItemId: true, quantity: true },
    });
  },

  deleteItemsByShipmentId(shipmentId: string, db: DbClient = prisma) {
    return (db as typeof prisma).shipmentItem.deleteMany({ where: { shipmentId } });
  },

};
