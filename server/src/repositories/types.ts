import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Data Layer（数据层）契约 —— 类型定义（Round R-1 Foundation）
 *
 * 分层方向（禁止反向依赖）：
 *
 *   Controller  →  Business(services)  →  Operation(operations)  →  Data(repositories)  →  Prisma
 *     HTTP          业务规则/状态机        多仓储组合/事务编排        查询与持久化
 *
 * 本文件只冻结「数据层对外暴露的客户端类型」，不含任何运行时逻辑，
 * 也不迁移任何既有 Controller（批量迁移属后续轮次）。
 */

/**
 * 可在**事务内外通用**的 Prisma 客户端。
 *
 * - 事务外：全局单例（`src/lib/prisma.ts`，唯一实例，不新建第二套）
 * - 事务内：`$transaction(async (tx) => ...)` 回调交出的 `tx`
 *
 * **Repository 的每个方法都应把该类型作为最后一个入参（带默认值）**，
 * 从而同一份仓储代码既能被 Business 层直接调用，也能被 Operation 层
 * 在同一事务内组合，无需为「事务版 / 非事务版」各写一份实现。
 *
 * 约定示例（示例代码，不代表本轮已创建该文件）：
 *
 * ```ts
 * import prisma from '../lib/prisma';
 * import type { DbClient } from './types';
 *
 * export const customerRepository = {
 *   findById: (id: string, db: DbClient = prisma) => db.customer.findUnique({ where: { id } }),
 * };
 * ```
 */
export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * **必须处于事务中**的客户端。
 *
 * 仅用于 Operation 层的编排函数签名：这些函数要求调用方（Business 层或 Controller）
 * 已经开启事务，因此不接受「无事务」的全局单例，避免误用导致部分写入。
 */
export type TxClient = Prisma.TransactionClient;
