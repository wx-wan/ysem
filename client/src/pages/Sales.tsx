import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { App, Button, Card, Pagination, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { debounce } from '../utils/rateLimit';
import { theme } from 'antd';

import FilterToolbar, { FilterGroup } from '../components/common/FilterToolbar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import SalesFormModal from '../components/sales/SalesFormModal';
import OpportunityCardList from '../components/sales/OpportunityCardList';
import OpportunityDetailPanel from '../components/sales/OpportunityDetailPanel';
import { useOpportunityList } from '../components/sales/useOpportunityList';
import { useLeadOptions } from '../components/lead/useLeadOptions';
import { flattenChannelOptions, flattenPlatformOptions } from '../components/lead/constants';
import { buildTablePagination } from '../components/common/tablePagination';
import { salesApi, type SalesItem } from '../api/sales';
import { useAuthStore } from '../stores/useAuthStore';

export default function Sales() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdmin = useAuthStore((s) => s.user?.role?.code === 'admin');
  const { channels } = useLeadOptions();

  const list = useOpportunityList();

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

  // 深链：?pipelineId= 自动选中并展开详情（右侧面板）。
  // 状态栏切回「全部」，确保该记录在左侧列表中可见（其余状态的记录不在当前 tab 结果集内）；
  // 选中不依赖列表分页，详情按 id 直拉，避免切换状态视图导致定位丢失。
  const oppResolvedRef = useRef(false);
  useEffect(() => {
    const pid = searchParams.get('pipelineId');
    if (!pid || oppResolvedRef.current) return;
    oppResolvedRef.current = true;
    salesApi
      .get(pid)
      .then(() => {
        list.setStage('all');
        setSelectedId(pid);
        searchParams.delete('pipelineId');
        setSearchParams(searchParams, { replace: true });
      })
      .catch(() => {
        oppResolvedRef.current = false;
      });
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
    (list.filterOwner ? 1 : 0);

  const handleClear = () => {
    list.setFilterChannel(undefined);
    list.setFilterPlatform(undefined);
    list.setFilterOwner(undefined);
    list.setStage('all');
    setKw('');
    list.setKeyword('');
  };

  // 编辑（商机不支持新建 / 导入，只能由线索转商机产生，故无新建弹窗与导入弹窗）
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null);
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

  const ownerOptions = list.ownerOptions.map((o) => ({ key: o.id, label: o.realName || o.username }));

  return (
    <div>
      <Card
        variant="borderless"
        style={{
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <FilterToolbar
          searchPlaceholder={t('sales.searchPlaceholder')}
          searchValue={kw}
          onSearchChange={onSearchChange}
          sortOptions={[
            { value: 'createdAt:desc', label: t('common.sortLatest') },
            { value: 'createdAt:asc', label: t('common.sortEarliest') },
          ]}
          sortValue={list.sort}
          onSortChange={list.setSort}
          activeCount={activeCount}
          onClear={handleClear}
          tabs={
            // 商机状态切换（派生的商机阶段）：全部不做状态过滤，数据范围按角色分配
            <CapsuleSwitch<string>
              value={list.stage}
              onChange={(key) => {
                list.setStage(key);
                list.setPage(1);
              }}
              options={[
                { key: 'all', label: t('common.all') },
                { key: 'OPPORTUNITY', label: t('sales.stage.opportunity') },
                { key: 'FOLLOWING', label: t('sales.stage.following') },
                { key: 'QUOTED', label: t('sales.stage.quoted') },
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
            </Space>
          }
        >
          <FilterGroup
            label={t('lead.filterPlatform')}
            value={list.filterChannel}
            onChange={(key) => {
              list.setFilterChannel(key || undefined);
              list.setFilterPlatform(undefined);
              list.setPage(1);
            }}
            options={[
              { key: '', label: t('common.all') },
              ...flattenChannelOptions(channels).map((o) => ({ key: o.value, label: o.label })),
            ]}
          />
          <FilterGroup
            label={t('lead.filterShop')}
            value={list.filterPlatform}
            onChange={(key) => {
              list.setFilterPlatform(key || undefined);
              list.setPage(1);
            }}
            options={[
              { key: '', label: t('common.all') },
              ...flattenPlatformOptions(channels, list.filterChannel).map((o) => ({ key: o.value, label: o.label })),
            ]}
          />
          <FilterGroup
            label={t('sales.filterOwner')}
            value={list.filterOwner}
            onChange={(key) => {
              list.setFilterOwner(key || undefined);
              list.setPage(1);
            }}
            options={[{ key: '', label: t('common.all') }, ...ownerOptions]}
          />
        </FilterToolbar>

        {/* 卡片列表默认撑满整宽；点击卡片上的「查看详情」后才展开右侧详情面板 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', marginTop: 16 }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <OpportunityCardList
              dataSource={sortedData}
              loading={list.loading}
              selectedId={selectedId}
              // 与线索列表一致：再次点击已展开的记录即收起
              onSelect={(r) => setSelectedId((prev) => (prev === r.id ? null : r.id))}
            />
          </div>
          {selectedId && (
            <div className="lead-detail-col">
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
          )}
        </div>
      </Card>

      {/* 分页器与线索列表一致：卡片外居中、仅多页时出现、统一走 buildTablePagination（显示总数 + 跳至） */}
      {list.total > list.pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
          <Pagination
            {...buildTablePagination({
              total: list.total,
              page: list.page,
              pageSize: list.pageSize,
              onChange: (p, s) => {
                list.setPage(p);
                list.setPageSize(s);
              },
            })}
          />
        </div>
      )}

      {editingItem && (
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
      )}
    </div>
  );
}
