import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { salesApi, type SalesItem } from '../../api/sales';
import { useAuthStore } from '../../stores/useAuthStore';

export interface AssignUser {
  id: string;
  realName: string;
  username: string;
}

/** 商机列表：查询 / 筛选（渠道·平台·负责人·范围）/ 分页 / 删除 / 批量删除 / 刷新 */
export function useOpportunityList(initialStage?: string) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const currentUser = useAuthStore((s) => s.user);

  const [listData, setListData] = useState<SalesItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [filterChannel, setFilterChannel] = useState<string | undefined>();
  const [filterPlatform, setFilterPlatform] = useState<string | undefined>();
  const [filterOwner, setFilterOwner] = useState<string | undefined>();
  // 范围：mine=我的（ownerId=当前用户）；all=全部（受角色数据范围约束）
  const [scope, setScope] = useState<'mine' | 'all'>('all');
  const [sort, setSort] = useState('createdAt:desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  const [ownerOptions, setOwnerOptions] = useState<AssignUser[]>([]);

  const fetchOwners = useCallback(async () => {
    try {
      const res = await salesApi.getAssignUsers();
      setOwnerOptions(res.data.data || []);
    } catch {
      /* 负责人选项加载失败可忽略 */
    }
  }, []);

  useEffect(() => {
    fetchOwners();
  }, [fetchOwners]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
      if (keyword) params.keyword = keyword;
      if (filterChannel) params.channel = filterChannel;
      if (filterPlatform) params.platform = filterPlatform;
      // 负责人：显式选择优先；否则「我的」范围回落到当前用户
      const ownerId = filterOwner ?? (scope === 'mine' ? currentUser?.id : undefined);
      if (ownerId) params.ownerId = ownerId;
      if (initialStage) params.stage = initialStage;
      const res = await salesApi.list(params);
      setListData(res.data.data.list);
      setTotal(res.data.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterPlatform, filterOwner, scope, initialStage, currentUser?.id, message, t]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const refresh = useCallback(() => {
    fetchList();
  }, [fetchList]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await salesApi.delete(id);
        message.success(t('common.deleteSuccess'));
        refresh();
      } catch {
        message.error(t('common.deleteFailed'));
      }
    },
    [message, t, refresh],
  );

  const batchRemove = useCallback(
    async (ids: string[]) => {
      try {
        await salesApi.batchDelete(ids);
        message.success(t('common.deleteSuccess'));
        setSelectedKeys([]);
        refresh();
      } catch {
        message.error(t('common.deleteFailed'));
      }
    },
    [message, t, refresh],
  );

  return {
    listData,
    total,
    loading,
    selectedKeys,
    setSelectedKeys,
    keyword,
    setKeyword,
    filterChannel,
    setFilterChannel,
    filterPlatform,
    setFilterPlatform,
    filterOwner,
    setFilterOwner,
    ownerOptions,
    scope,
    setScope,
    sort,
    setSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    refresh,
    remove,
    batchRemove,
  };
}
