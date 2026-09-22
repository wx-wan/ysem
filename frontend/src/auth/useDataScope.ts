import { useMemo } from 'react';
import type { DataScope } from '../types/auth';
import { getDataScope } from './permissionUtils';
import { useCurrentUser } from './useCurrentUser';

export interface DataScopeContextValue {
  /** 仅 'ALL' | 'DEPT' | 'SELF'；未取到后端值时为 'SELF' */
  dataScope: DataScope;
  isAll: boolean;
  isDept: boolean;
  isSelf: boolean;
}

/**
 * Data Scope Context（选择器实现）。
 *
 * 取值**只**来自后端 `user.role.dataScope`（GET /api/auth/profile），
 * 前端不根据 role.code 自行推断（admin→ALL 只是当前 seed 的事实，不作为前端规则）。
 *
 * 用途：UI 提示、默认筛选、后续页面行为。
 * 严禁把 dataScope 当作安全控制 —— 后端 roleScope/applyScope 才是权威（F-2 §9）。
 * 「公海」不属于 Role.dataScope，它是 ownerId=null + includePublicSea() 的**业务视图状态**（F-2 §10）。
 */
export function useDataScope(): DataScopeContextValue {
  const { user } = useCurrentUser();

  return useMemo(() => {
    const dataScope = getDataScope(user);
    return {
      dataScope,
      isAll: dataScope === 'ALL',
      isDept: dataScope === 'DEPT',
      isSelf: dataScope === 'SELF',
    };
  }, [user]);
}

export default useDataScope;
