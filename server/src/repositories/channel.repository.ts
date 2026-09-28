import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Channel 数据访问（Round R-2 · Lead Pilot）
 *
 * 说明：本系统 Channel 为**自关联树**（父节点=渠道，子节点=平台/店铺），
 * 不存在独立的 Shop 模型，`shopId` 与 `channelId` 同指向 Channel 表。
 * 本节仅提供 Lead 路径实际需要的只读方法，不改造 Channel 架构。
 */
export const channelRepository = {
  /** 按 id 取渠道状态（用于「来源渠道」存在性 + ACTIVE 校验） */
  findStatusById(id: string, db: DbClient = prisma) {
    return db.channel.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  },

  /** 按 id 取平台/店铺状态与父级（用于「来源平台」存在性 + 父子一致性校验） */
  findStatusWithParentById(id: string, db: DbClient = prisma) {
    return db.channel.findUnique({
      where: { id },
      select: { id: true, parentId: true, status: true },
    });
  },

  /** 取渠道/平台显示名（用于操作日志 diff 的 ID → 名称解析） */
  findNameById(id: string, db: DbClient = prisma) {
    return db.channel.findUnique({
      where: { id },
      select: { name: true },
    });
  },

  // ============================================================
  // Round R-5 · Phase 1（B4）：删除保护所需的**引用计数**（只读）
  // ============================================================

  /**
   * 被销售记录引用计数：Customer / Lead / Opportunity 的 `channelId` 或 `shopId`
   * 指向该 Channel 的行数合计。
   *
   * 说明：本系统 Channel 为自关联树（父=渠道 / 子=平台），**不存在独立 Shop 模型**，
   * 因此一个 id 既可能被 `channelId` 引用，也可能被 `shopId` 引用，两者都要计入。
   * 仓储只负责计数，**不决定**「被引用是否允许删除」（业务政策在 Business 层）。
   */
  async countSalesReferences(id: string, db: DbClient = prisma): Promise<{
    customers: number;
    leads: number;
    opportunities: number;
    total: number;
  }> {
    const or = [{ channelId: id }, { shopId: id }];
    const [customers, leads, opportunities] = await Promise.all([
      db.customer.count({ where: { OR: or } }),
      db.lead.count({ where: { OR: or } }),
      db.opportunity.count({ where: { OR: or } }),
    ]);
    return { customers, leads, opportunities, total: customers + leads + opportunities };
  },

  /** 子节点计数（父渠道是否仍挂平台） */
  countChildren(id: string, db: DbClient = prisma): Promise<number> {
    return db.channel.count({ where: { parentId: id } });
  },

  // ============================================================
  // Round R-5 · Phase 2：Channel / Shop 属主访问（主数据 CRUD）
  // ============================================================

  /** 全部渠道 / 平台（既有排序口径逐字沿用） */
  findAll(db: DbClient = prisma) {
    return db.channel.findMany({ orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  },

  /** 单条（详情 / 父级类别继承） */
  findById(id: string, db: DbClient = prisma) {
    return db.channel.findUnique({ where: { id } });
  },

  create(data: Prisma.ChannelUncheckedCreateInput, db: DbClient = prisma) {
    return db.channel.create({ data });
  },

  update(id: string, data: Prisma.ChannelUncheckedUpdateInput, db: DbClient = prisma) {
    return db.channel.update({ where: { id }, data });
  },

  delete(id: string, db: DbClient = prisma) {
    return db.channel.delete({ where: { id } });
  },
};
