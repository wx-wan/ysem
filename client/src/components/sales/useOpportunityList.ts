import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { salesApi, type SalesItem } from '../../api/sales';

export interface AssignUser {
  id: string;
  realName: string;
  username: string;
}

/** 商机列表：查询 / 筛选（渠道·平台·负责人·状态）/ 分页 / 删除 / 批量删除 / 刷新 */
export function useOpportunityList() {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [listData, setListData] = useState<SalesItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [filterChannel, setFilterChannel] = useState<string | undefined>();
  const [filterPlatform, setFilterPlatform] = useState<string | undefined>();
  const [filterOwner, setFilterOwner] = useState<string | undefined>();
  // 商机状态（派生阶段）切换：all=全部（数据范围按角色分配，不做状态过滤）
  const [stage, setStage] = useState<string>('all');
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
      if (filterOwner) params.ownerId = filterOwner;
      // 状态筛选：阶段为派生值，后端先取全量再过滤（详见 opportunity.service.listOpportunities）
      if (stage && stage !== 'all') params.stage = stage;
      const res = await salesApi.list(params);
      setListData(res.data.data.list);
      setTotal(res.data.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterPlatform, filterOwner, stage, message, t]);

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
    stage,
    setStage,
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
