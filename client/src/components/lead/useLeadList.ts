import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { leadApi, type Lead, type LeadStatus } from '../../api/lead';

/** 线索列表：查询 / 筛选 / 分页 / 删除 / 批量删除 / 刷新 */
export function useLeadList() {
  const { t } = useTranslation();
  const { message } = App.useApp();

  const [listData, setListData] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选条件
  const [keyword, setKeyword] = useState('');
  const [filterChannel, setFilterChannel] = useState<string | undefined>();
  const [filterPlatform, setFilterPlatform] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<LeadStatus | undefined>();
  // 列表范围：mine=我的线索；pool=公海（已释放、无负责人）
  const [scope, setScope] = useState<'mine' | 'pool'>('mine');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(19);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
        channel: filterChannel,
        platform: filterPlatform,
        status: filterStatus,
        scope,
      });
      setListData(res.data.list);
      setTotal(res.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterPlatform, filterStatus, scope, message, t]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const refresh = useCallback(() => {
    fetchList();
  }, [fetchList]);

  const remove = useCallback(
    async (id: string) => {
      try {
        await leadApi.delete(id);
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
        await Promise.all(ids.map((id) => leadApi.delete(id)));
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
    filterStatus,
    setFilterStatus,
    scope,
    setScope,
    page,
    setPage,
    pageSize,
    setPageSize,
    refresh,
    remove,
    batchRemove,
  };
}
