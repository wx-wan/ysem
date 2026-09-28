import type { AttachmentOwnerType, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Attachment 数据访问（Round R-2 · Lead Pilot）
 *
 * Attachment 为**多态旁挂**表（ownerType + ownerId，无反向 relation）。
 * 本节按 Lead 路径实际需要提供方法；不引入第二套附件机制。
 */
export const attachmentRepository = {
  /** 批量按宿主拉取（既有实现用 ownerId in [...] 避免 N+1） */
  findByOwnerTypeAndIds(ownerType: AttachmentOwnerType, ownerIds: string[], db: DbClient = prisma) {
    return db.attachment.findMany({
      where: { ownerType, ownerId: { in: ownerIds } },
      orderBy: { sort: 'asc' },
    });
  },

  /** 单条：必须是该宿主的附件（越权删除防护） */
  findOwnedById(ownerType: AttachmentOwnerType, ownerId: string, id: string, db: DbClient = prisma) {
    return db.attachment.findFirst({ where: { id, ownerType, ownerId } });
  },

  /** 删除某宿主的全部附件（整组替换语义的前半段） */
  deleteByOwner(ownerType: AttachmentOwnerType, ownerId: string, db: DbClient = prisma) {
    return db.attachment.deleteMany({ where: { ownerType, ownerId } });
  },

  createMany(data: Prisma.AttachmentCreateManyInput[], db: DbClient = prisma) {
    return db.attachment.createMany({ data });
  },

  deleteById(id: string, db: DbClient = prisma) {
    return db.attachment.delete({ where: { id } });
  },
};
