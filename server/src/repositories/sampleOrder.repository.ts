import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * SampleOrder 数据访问 —— **仅供 Customer 报表读模型使用**（Round R-3 · Customer Pilot）
 *
 * 范围限制：只提供报表实际需要的计数，不迁移打样模块自身的 CRUD 与状态机。
 */
export const sampleOrderRepository = {
  /** 打样单总数（客户报表「下打样单」阶段计数） */
  count(db: DbClient = prisma) {
    return db.sampleOrder.count();
  },
};
