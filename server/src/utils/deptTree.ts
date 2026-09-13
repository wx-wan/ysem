import prisma from '../lib/prisma';

/**
 * 部门树（Department Tree）通用工具
 *
 * V1.0 `Department` 通过 `parentId` 自关联，**不限定层级数**。
 * 当前组织虽然只有「总部 + 5 个一级部门」两层，但代码不得写死层级：
 *
 *   A
 *   └── B
 *       └── C
 *           └── D
 *
 * 实现要求：
 *  - 一次 `findMany()` 加载全部部门，在内存中构建父子索引；**不得**逐层 `findMany(parentId=...)`
 *    递归查库（N+1）。
 *  - 遍历时用 visited 集合去重，防止 `parentId` 成环导致死循环。
 */

export interface DepartmentNode {
  id: string;
  parentId: string | null;
}

export interface DepartmentTree {
  /** 部门 id → 上级部门 id */
  parentOf: Map<string, string | null>;
  /** 部门 id → 直接下级部门 id 列表 */
  childrenOf: Map<string, string[]>;
  /** 全部部门 id */
  ids: string[];
}

/**
 * 一次性加载全部部门并构建内存父子索引。
 * 部门总量为个位数~几十量级，全量加载成本可忽略。
 */
export const loadDepartmentTree = async (): Promise<DepartmentTree> => {
  const departments = await prisma.department.findMany({
    select: { id: true, parentId: true },
  });

  const parentOf = new Map<string, string | null>();
  const childrenOf = new Map<string, string[]>();

  for (const dept of departments) {
    parentOf.set(dept.id, dept.parentId);
    if (!childrenOf.has(dept.id)) childrenOf.set(dept.id, []);
  }
  for (const dept of departments) {
    if (!dept.parentId) continue;
    const siblings = childrenOf.get(dept.parentId);
    if (siblings) siblings.push(dept.id);
    else childrenOf.set(dept.parentId, [dept.id]);
  }

  return { parentOf, childrenOf, ids: departments.map((d) => d.id) };
};

/**
 * 收集 `rootId` 自身 + 全部下级部门 id（层级无关，去重，防环）。
 * 返回值顺序稳定：根节点在前，随后按 BFS 层级展开。
 */
export const collectDepartmentIds = (
  tree: DepartmentTree,
  rootId: string,
): string[] => {
  const result: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    // 防环：重复入队的节点只处理一次
    if (visited.has(current)) continue;
    visited.add(current);
    result.push(current);

    const children = tree.childrenOf.get(current);
    if (children && children.length > 0) queue.push(...children);
  }

  return result;
};

/** 便捷方法：返回指定部门自身 + 全部下级部门 id；`departmentId` 为空时返回空数组。 */
export const getDepartmentAndDescendantIds = async (
  departmentId?: string | null,
): Promise<string[]> => {
  if (!departmentId) return [];
  const tree = await loadDepartmentTree();
  return collectDepartmentIds(tree, departmentId);
};

/**
 * DEPT（本部门及下级部门）档位的 `ownerId` 集合：
 *   当前用户所在部门 + 其全部下级部门下的所有用户 id。
 *
 * - 用户未配置部门时退化为 `[userId]`（保证至少能看到自己的数据）。
 * - 部门下无其他用户时同样兜底包含本人。
 */
export const getDepartmentScopeUserIds = async (userId: string): Promise<string[]> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  });
  if (!user?.departmentId) return [userId];

  const departmentIds = await getDepartmentAndDescendantIds(user.departmentId);
  const users = await prisma.user.findMany({
    where: { departmentId: { in: departmentIds } },
    select: { id: true },
  });

  const userIds = users.map((u) => u.id);
  return userIds.length > 0 ? Array.from(new Set(userIds)) : [userId];
};
