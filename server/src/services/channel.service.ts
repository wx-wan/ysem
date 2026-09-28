import { MasterStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainConflictError, DomainNotFoundError } from '../lib/errors';
import { channelRepository } from '../repositories';

/**
 * Channel Business Layer —— Round R-5 · Phase 1（B4 删除保护）/ Phase 2（主数据 CRUD）
 *
 * Channel 是**真正的业务主数据**：自关联树（父节点=渠道，子节点=平台/店铺），
 * 被 Customer 首次获客事实、Lead 销售流程起始渠道、Opportunity 承载渠道共同引用。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例
 *（`Prisma.Channel*Input` 类型导入合法 —— 仅类型，不产生数据访问）。
 */

/** 渠道 / 平台入参 schema（与迁移前 Controller 内 schema 逐字一致） */
export const channelSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  category: z.enum(['ONLINE', 'OFFLINE']).optional(),
  parentId: z.string().optional().nullable(),
  contact: z.string().trim().max(100).optional(),
  status: z.nativeEnum(MasterStatus).optional(),
  sort: z.number().int().optional(),
  remark: z.string().trim().max(500).optional(),
});

export type ChannelInput = z.infer<typeof channelSchema>;

/** 全部渠道（下拉 / 级联选择） */
export function listAll() {
  return channelRepository.findAll();
}

/** 树形结构：父节点(渠道) → children(平台)（构建口径与既有实现逐字一致） */
export async function tree() {
  const list = await channelRepository.findAll();
  const map = new Map<string, Record<string, unknown>>();
  list.forEach((c) => map.set(c.id, { ...c, children: [] as unknown[] }));
  const result: Record<string, unknown>[] = [];
  map.forEach((node) => {
    const parentId = node.parentId as string | null;
    if (parentId && map.has(parentId)) {
      (map.get(parentId)!.children as unknown[]).push(node);
    } else {
      result.push(node);
    }
  });
  return result;
}

/** 详情（不存在 → 404「渠道不存在」） */
export async function getOne(id: string) {
  const item = await channelRepository.findById(id);
  if (!item) throw new DomainNotFoundError('渠道不存在');
  return item;
}

/** 新建（子级平台自动继承父级类别；sort 缺省 0；status 缺省 ACTIVE） */
export async function create(data: ChannelInput) {
  let category = data.category ?? 'ONLINE';
  if (data.parentId) {
    const parent = await channelRepository.findById(data.parentId);
    if (parent) category = parent.category as 'ONLINE' | 'OFFLINE';
  }
  return channelRepository.create({
    name: data.name,
    category,
    parentId: data.parentId ?? null,
    contact: data.contact ?? null,
    status: data.status ?? MasterStatus.ACTIVE,
    sort: data.sort ?? 0,
    remark: data.remark ?? null,
  });
}

/** 更新（局部；显式 null 的 parentId 必须显式落 null，不能依赖 undefined 语义） */
export async function update(id: string, data: Partial<ChannelInput>) {
  // 类型化 payload：Record<string, unknown> 会擦除 status 的 MasterStatus 校验
  const payload: Prisma.ChannelUncheckedUpdateInput = { ...data };
  if (data.parentId === null) payload.parentId = null;
  await channelRepository.update(id, payload);
}

/**
 * 删除（B4 冻结）：已被销售记录引用 ⇒ 禁止删除，只允许停用。
 * 检查范围不限于 Customer：Customer / Lead / Opportunity 的 channelId 与 shopId 引用一并计入。
 */
export async function remove(id: string): Promise<void> {
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
  await channelRepository.delete(id);
}

/**
 * （保留）Phase 1 暴露的删除保护断言 —— 供他处（如测试）按 id 校验可删性。
 * 与 `remove` 内的校验共用同一口径，不重复实现。
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
