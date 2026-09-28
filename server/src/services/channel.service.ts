import { DomainConflictError } from '../lib/errors';
import { channelRepository } from '../repositories';

/**
 * Channel Business Layer（最小实现）—— Round R-5 · Phase 1 · B4
 *
 * 本文件**只**承载 Phase 1 必须落地的删除保护政策，不展开 Phase 2 的 Channel 完整重构。
 *
 * 【B4 冻结】已被销售记录引用的 Channel / Shop：
 *   - **禁止**物理删除（DELETE 必须 REJECT）—— 否则 Customer 首次获客事实、
 *     Lead 销售流程起始渠道、Opportunity 承载渠道会因 `onDelete: SetNull` 而丢失；
 *   - **允许**停用（status = DISABLED / inactive），历史关系仍然可追溯。
 *
 * 检查范围**不限于 Customer**：Customer / Lead / Opportunity 三处
 * `channelId` 与 `shopId` 引用一并计入（Channel 为自关联树，无独立 Shop 模型）。
 */
export async function assertChannelDeletable(id: string): Promise<void> {
  const refs = await channelRepository.countSalesReferences(id);
  if (refs.total > 0) {
    const parts: string[] = [];
    if (refs.customers > 0) parts.push(`${refs.customers} 个客户`);
    if (refs.leads > 0) parts.push(`${refs.leads} 条线索`);
    if (refs.opportunities > 0) parts.push(`${refs.opportunities} 个商机`);
    throw new DomainConflictError(
      `该渠道/平台已被${parts.join('、')}引用，禁止删除；如需停止使用请改为「停用」。`,
    );
  }
}
