import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, Card, Pagination, Space } from 'antd';
import { ImportOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { debounce } from '../utils/rateLimit';
import { theme } from 'antd';

import FilterToolbar, { FilterGroup } from '../components/common/FilterToolbar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import ImportModal from '../components/sales/ImportModal';
import SalesFormModal from '../components/sales/SalesFormModal';
import OpportunityCardList from '../components/sales/OpportunityCardList';
import OpportunityDetailPanel from '../components/sales/OpportunityDetailPanel';
import { useOpportunityList } from '../components/sales/useOpportunityList';
import { useLeadOptions } from '../components/lead/useLeadOptions';
import { flattenChannelOptions, flattenPlatformOptions } from '../components/lead/constants';
import { salesApi, type SalesItem } from '../api/sales';
import { useAuthStore } from '../stores/useAuthStore';
import type { SalesStage } from '../components/sales/stages';

export default function Sales({ fixedStage }: { fixedStage?: SalesStage }) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useAuthStore((s) => s.user?.role?.code === 'admin');
  const { channels } = useLeadOptions();

  const list = useOpportunityList(fixedStage);

  // 搜索（防抖）
  const [kw, setKw] = useState('');
  const commitKeyword = useMemo(
    () => debounce((v: string) => list.setKeyword(v), 350),
    [list.setKeyword],
  );
  const onSearchChange = (v: string) => {
    setKw(v);
    commitKeyword(v);
  };

  // 选中详情
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SalesItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refetchDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await salesApi.get(selectedId);
      setDetail(res.data.data);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId, message, t]);

  useEffect(() => {
    refetchDetail();
  }, [refetchDetail]);

  // 深链：?pipelineId= 自动打开详情
  useEffect(() => {
    const pid = searchParams.get('pipelineId');
    if (pid) {
      setSelectedId(pid);
      searchParams.delete('pipelineId');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // 客户端按创建时间排序（后端列表暂按更新时间返回，前端对齐线索排序交互）
  const sortedData = useMemo(() => {
    const arr = [...list.listData];
    if (list.sort === 'createdAt:asc') {
      arr.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    return arr;
  }, [list.listData, list.sort]);

  const activeCount =
    (list.filterChannel ? 1 : 0) +
    (list.filterPlatform ? 1 : 0) +
    (list.filterOwner ? 1 : 0) +
    (list.scope === 'mine' ? 1 : 0);

  const handleClear = () => {
    list.setFilterChannel(undefined);
    list.setFilterPlatform(undefined);
    list.setFilterOwner(undefined);
    list.setScope('all');
    setKw('');
    list.setKeyword('');
  };

  // 新建 / 编辑
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null);
  const handleCreate = () => {
    setEditingItem(null);
    setModalOpen(true);
  };
  const handleEdit = (item: SalesItem) => {
    setEditingItem(item);
    setModalOpen(true);
  };
  const handleDelete = async (item: SalesItem) => {
    await list.remove(item.id);
    if (selectedId === item.id) {
      setSelectedId(null);
      setDetail(null);
    }
  };

  // Excel 导入
  const [importOpen, setImportOpen] = useState(false);

  const ownerOptions = list.ownerOptions.map((o) => ({ key: o.id, label: o.realName || o.username }));

  return (
    <Card className="sales-card" styles={{ body: { padding: 16 } }}>
      <FilterToolbar
        searchPlaceholder={t('sales.searchPlaceholder')}
        searchValue={kw}
        onSearchChange={onSearchChange}
        sortOptions={[
          { value: 'createdAt:desc', label: t('lead.sortLatest') },
          { value: 'createdAt:asc', label: t('lead.sortEarliest') },
        ]}
        sortValue={list.sort}
        onSortChange={list.setSort}
        activeCount={activeCount}
        onClear={handleClear}
        tabs={
          <CapsuleSwitch
            value={list.scope}
            onChange={list.setScope}
            options={[
              { value: 'mine', label: t('sales.scopeMine') },
              { value: 'all', label: t('sales.scopeAll') },
            ]}
          />
        }
        total={list.total}
        actions={
          <Space>
            {isAdmin && list.selectedKeys.length > 0 && (
              <Button danger onClick={() => list.batchRemove(list.selectedKeys)}>
                {t('common.batchDelete')}
              </Button>
            )}
            <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>
              {t('sales.import')}
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              {t('sales.newRecord')}
            </Button>
          </Space>
        }
      >
        <FilterGroup label={t('lead.filterPlatform')} value={list.filterChannel} onChange={list.setFilterChannel}>
          {[{ key: 'all', label: t('common.all') }, ...flattenChannelOptions(channels)].map((o) => ({
            key: o.key,
            label: o.label,
          }))}
        </FilterGroup>
        <FilterGroup
          label={t('lead.filterShop')}
          value={list.filterPlatform}
          onChange={list.setFilterPlatform}
        >
          {[{ key: 'all', label: t('common.all') }, ...flattenPlatformOptions(channels, list.filterChannel)].map(
            (o) => ({ key: o.key, label: o.label }),
          )}
        </FilterGroup>
        <FilterGroup label={t('sales.filterOwner')} value={list.filterOwner} onChange={list.setFilterOwner}>
          {[{ key: 'all', label: t('common.all') }, ...ownerOptions].map((o) => ({ key: o.key, label: o.label }))}
        </FilterGroup>
      </FilterToolbar>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <OpportunityCardList
            dataSource={sortedData}
            loading={list.loading}
            selectedId={selectedId}
            onSelect={(r) => setSelectedId(r.id)}
          />
        </div>
        <div
          className="lead-detail-col"
          style={{ width: 380, flexShrink: 0, position: 'sticky', top: 16, alignSelf: 'flex-start' }}
        >
          <OpportunityDetailPanel
            detail={detail}
            loading={detailLoading}
            isAdmin={isAdmin}
            onClose={() => {
              setSelectedId(null);
              setDetail(null);
            }}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 12,
          color: token.colorTextSecondary,
          fontSize: 13,
        }}
      >
        <span>{t('lead.resultCount', { total: list.total })}</span>
        <Pagination
          current={list.page}
          pageSize={list.pageSize}
          total={list.total}
          showSizeChanger={false}
          onChange={(p) => list.setPage(p)}
        />
      </div>

      <SalesFormModal
        open={modalOpen}
        editingItem={editingItem}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          setModalOpen(false);
          setEditingItem(null);
          list.refresh();
          if (selectedId) refetchDetail();
        }}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => list.refresh()} />
    </Card>
  );
}
