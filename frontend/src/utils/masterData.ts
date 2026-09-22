import type { Channel, MasterStatus } from '../types/masterData';

/**
 * 渠道树纯函数（Round F-4 §11 / §22）
 *
 * 背景：GET /api/channels/tree **不过滤** `status`（F-4A G-2 已确认），
 * 因此「可选项集合」必须由消费方显式收敛，且只能在本函数内完成，不得散落在组件里。
 *
 * 规则：
 *   · 节点 status === 'ACTIVE' 才保留；
 *   · 递归过滤 children；
 *   · **父级 INACTIVE ⇒ 整棵父分支丢弃**（其 ACTIVE 子节点也不作为可选渠道，
 *     因为父渠道已停用，选择子平台会破坏渠道层级语义）。
 *
 * 约束：pure / 不修改入参 / 不修改后端数据（返回新对象与新数组）。
 */
export function filterActiveChannels(tree: readonly Channel[], status: MasterStatus = 'ACTIVE'): Channel[] {
  const result: Channel[] = [];
  for (const node of tree) {
    if (node.status !== status) continue;
    result.push({
      ...node,
      children: node.children && node.children.length > 0 ? filterActiveChannels(node.children, status) : [],
    });
  }
  return result;
}

/** 扁平化渠道树（便于做计数 / select 选项；同样不改动入参） */
export function flattenChannels(tree: readonly Channel[]): Channel[] {
  const out: Channel[] = [];
  const walk = (nodes: readonly Channel[]) => {
    for (const node of nodes) {
      out.push(node);
      if (node.children && node.children.length > 0) walk(node.children);
    }
  };
  walk(tree);
  return out;
}

/** 统计渠道树节点总数（含各级子节点） */
export function countChannels(tree: readonly Channel[]): number {
  return flattenChannels(tree).length;
}
