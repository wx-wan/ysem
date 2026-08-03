/**
 * 通用数据对比工具：在更新前先对比新旧数据，只回传真正发生变化的字段。
 * 用于「列表 / 详情」局部刷新时避免无意义的整页重排与重渲染。
 */

type Plain = Record<string, any>;

/**
 * 对比两个对象（浅对比，顶层字段），返回仅包含「值发生变化」字段的增量对象。
 * - 若两对象完全一致，返回 null（调用方据此跳过 state 更新）。
 * - 数组 / 对象按引用比较（引用不同即视为变化），不做深递归。
 */
export function pickChanged<T extends Plain>(prev: T | null | undefined, next: T): Partial<T> | null {
  if (!prev) return next;
  const out: Partial<T> = {};
  let hasChange = false;
  // 以 next 的键为准，覆盖新增 / 修改字段
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (prev[key] !== next[key]) {
      (out as Plain)[key as string] = next[key];
      hasChange = true;
    }
  }
  // 处理 next 中缺失、但 prev 中存在的字段（被清空）
  for (const key of Object.keys(prev) as (keyof T)[]) {
    if (!(key in next)) {
      (out as Plain)[key as string] = undefined as any;
      hasChange = true;
    }
  }
  return hasChange ? out : null;
}

/**
 * 对一组列表项做「差异合并」：以 id 为键对齐 prev 与 next，
 * 仅对真正变化的项应用 diff 增量。返回：
 *  - mergedList：对齐后的完整列表（结构稳定，未变化项保持原引用）
 *  - changedIds：发生变化项的 id 集合
 * 调用方可依据 changedIds 是否为空决定是否触发 setList / 重排序。
 */
export function diffList<T extends Plain>(
  prevList: T[],
  nextList: T[],
  idKey: keyof T = 'id' as keyof T
): { mergedList: T[]; changedIds: Set<string> } {
  const prevMap = new Map<string, T>();
  for (const item of prevList) prevMap.set(String(item[idKey]), item);

  const changedIds = new Set<string>();
  const mergedList = nextList.map((nextItem) => {
    const id = String(nextItem[idKey]);
    const prevItem = prevMap.get(id);
    if (!prevItem) {
      changedIds.add(id);
      return nextItem; // 新增项
    }
    const delta = pickChanged(prevItem, nextItem);
    if (delta) {
      changedIds.add(id);
      return { ...prevItem, ...delta };
    }
    return prevItem; // 未变化：保持原引用，避免子组件重渲染
  });

  return { mergedList, changedIds };
}
