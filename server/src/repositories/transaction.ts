import type { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import type { TxClient } from './types';

/**
 * Data Layer —— 事务入口（Round R-1 Foundation）
 *
 * 复用现有 `prisma.$transaction`（不引入第二套事务机制、不新增连接池）。
 * 存在的意义只有一个：把「事务客户端类型」收敛成 `TxClient`，
 * 让 Operation 层与 Repository 层有统一的组合入口。
 *
 * 与既有写法的关系（行为完全一致，可逐模块替换）：
 *
 * ```ts
 * // 既有（散落在 Controller 中）
 * await prisma.$transaction(async (tx) => { ... });
 *
 * // 目标（同一实现，仅收敛入口）
 * await runInTransaction(async (tx) => { ... });
 * ```
 */

export interface TransactionOptions {
  /** 等待一条空闲连接的最长时间（ms），Prisma 默认 2000 */
  maxWait?: number;
  /** 事务本身的最长执行时间（ms），Prisma 默认 5000 */
  timeout?: number;
  /** 隔离级别；不传则由 PostgreSQL 默认（READ COMMITTED）决定 */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * 在事务中执行 `fn`，并把事务客户端作为 `TxClient` 交给回调。
 *
 * 说明：
 * - 交互式事务（interactive transaction），语义与 `prisma.$transaction(fn, options)` 完全一致；
 * - 回调抛错 → 事务回滚（与既有代码行为一致，无额外包装、无错误吞并）；
 * - **不**在此处写 OperationLog、**不**做业务判断 —— 这两件事分别属 Operation 层与 Business 层。
 */
export async function runInTransaction<T>(
  fn: (tx: TxClient) => Promise<T>,
  options?: TransactionOptions,
): Promise<T> {
  return prisma.$transaction(fn, options);
}
