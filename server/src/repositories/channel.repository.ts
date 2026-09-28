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
};
