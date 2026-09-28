import { runInTransaction } from '../repositories';
import { dictionaryRepository, type DictionaryTable } from '../repositories/dictionary.repository';

/**
 * Dictionary Operation Layer —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 本文件**只**承载字典域唯一真正需要事务的操作：批量更新排序。
 *
 * 【与既有实现的等价性（明示）】
 *   迁移前：`prisma.$transaction(items.map(i => prisma.X.update(...)))` —— **数组式**批量事务。
 *   迁移后：`runInTransaction(async (tx) => { 逐条 update(tx) })` —— **交互式**事务。
 *   两者均为「全部成功或全部回滚」的原子语义，对外可观测结果一致；
 *   差异仅在 Prisma 内部执行形态（批量提交 vs 逐条提交），不改变任何响应或错误语义。
 *
 * 事务归属（Master Plan §12 / B6 原则）：`$transaction` 只允许出现在 Operation 层。
 */
export function updateDictionarySortOperation(
  table: DictionaryTable,
  items: { id: string; sort: number }[],
): Promise<void> {
  return runInTransaction(async (tx) => {
    for (const item of items) {
      await dictionaryRepository.updateSort(table, item.id, item.sort, tx);
    }
  });
}
