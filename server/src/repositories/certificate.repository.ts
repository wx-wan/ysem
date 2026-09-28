import prisma from '../lib/prisma';
import type { DbClient } from './types';

/**
 * Certificate（认证资质）数据访问 —— Round R-4 · Product Layering
 *
 * 范围限制：只提供 Product 流程实际需要的**只读**能力：
 *   · Excel 导入的「认证名称 → id」解析
 *   · 操作日志差异比对的「认证 id → 名称」解析
 * 不迁移 Certificate 模块自身的 CRUD（属后续轮次）。
 *
 * 不负责：业务规则、权限政策、HTTP。
 */
export const certificateRepository = {
  /** 导入用：全部认证的名称 → id 映射来源 */
  findNameIdPairs(db: DbClient = prisma) {
    return db.certificate.findMany({ select: { id: true, name: true } });
  },

  /** 差异比对用：按 id 集合取认证名称 */
  findNamesByIds(ids: string[], db: DbClient = prisma) {
    return db.certificate.findMany({ where: { id: { in: ids } }, select: { name: true } });
  },
};
