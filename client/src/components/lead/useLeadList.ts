import { useCallback, useEffect, useState } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { leadApi, type Lead, type LeadStatus } from '../../api/lead';
import { STATUS_META } from './constants';

/** 切换栏：新线索（默认）/ 已确认 / 公海 */
export type LeadListTab = 'new' | 'confirmed' | 'pool';

/**
 * 「已确认」= **已确认及之后**（CONFIRMED → SAMPLED → WON）。
 * 状态只由单据事件自动推进，故除「新线索」外的状态统一归入该档，避免已打样 / 已成交的线索看不到。
 */
const CONFIRMED_STATUSES = (Object.keys(STATUS_META) as LeadStatus[]).filter((s) => s !== 'NEW');

/** 线索列表：查询 / 筛选 / 分页 / 删除 / 批量删除 / 刷新 */
export function useLeadList(isAdmin: boolean) {
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
  // 切换栏（默认「新线索」）：新线索 / 已确认 / 公海
  const [tab, setTab] = useState<LeadListTab>('new');
  // 切换栏 → 列表范围：公海；其余为我的（管理员看全部已归属）
  const scope: 'mine' | 'all' | 'pool' = tab === 'pool' ? 'pool' : isAdmin ? 'all' : 'mine';
  // 切换栏 → 状态条件：新线索 = NEW；已确认 = 已确认及之后；公海不限状态
  const status: string | undefined =
    tab === 'new' ? 'NEW' : tab === 'confirmed' ? CONFIRMED_STATUSES.join(',') : undefined;
  // 排序（后端白名单，格式 字段:方向）
  const [sort, setSort] = useState('createdAt:desc');
  const [page, setPage] = useState(1);
  // 单页显示 5 条记录
  const [pageSize, setPageSize] = useState(5);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
        channel: filterChannel,
        platform: filterPlatform,
        status,
        scope,
        sort,
      });
      setListData(res.data.list);
      setTotal(res.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterPlatform, status, scope, sort, message, t]);

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
    tab,
    setTab,
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
