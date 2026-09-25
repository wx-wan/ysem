import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pagination, Button, Popconfirm, App, theme } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import FilterToolbar, { FilterGroup } from '../components/common/FilterToolbar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import LeadFormModal, { type LeadFormModalHandle } from '../components/lead/LeadFormModal';
import LeadCardList from '../components/lead/LeadCardList';
import LeadDetailPanel from '../components/lead/LeadDetailPanel';
import { useLeadList } from '../components/lead/useLeadList';
import { useLeadOptions } from '../components/lead/useLeadOptions';
import { leadApi, type Lead, type LeadStatus } from '../api/lead';
import { STATUS_META, flattenChannelOptions, flattenPlatformOptions } from '../components/lead/constants';
import { useReleaseToPool } from '../hooks/useReleaseToPool';
import { buildTablePagination } from '../components/common/tablePagination';
import { useAuthStore } from '../stores/useAuthStore';
import { useUserStore } from '../stores/useUserStore';

export default function SalesLeads() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = App.useApp();

  // 用户 / 权限
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role?.code === 'admin';
  const fetchUsers = useUserStore((s) => s.fetchUsers);
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 列表数据 + 筛选 + 分页
  const list = useLeadList();
  // 统一「释放到公海」确认弹窗（客户 / 线索共用）
  const releaseToPool = useReleaseToPool();
  // 表单选项数据（渠道 / 产品 / 分类 / 客户）
  const { channels, productOptions, crafts, audiences, customerOptions, fetchCustomers, fetchProducts } =
    useLeadOptions();

  const formModalRef = useRef<LeadFormModalHandle>(null);

  // 卡片选中 → 右侧详情面板：拉取完整详情（含联系人/附件等列表接口不含的字段）
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Lead | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const refetchDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await leadApi.get(selectedId);
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    refetchDetail();
  }, [refetchDetail]);

  // 列表刷新后：选中项不在列表中则自动选中第一条，保持右侧面板始终有内容
  useEffect(() => {
    if (!list.listData.length) {
      setSelectedId(null);
      setDetail(null);
      return;
    }
    if (!selectedId || !list.listData.some((l) => l.id === selectedId)) {
      setSelectedId(list.listData[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.listData]);

  // 删除（详情面板/列表通用）：删除的是当前选中项时清空右侧面板
  const handleRemove = useCallback(
    async (id: string) => {
      await list.remove(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
    },
    [list, selectedId],
  );

  // 确认线索 → 打开编辑弹窗的「确认商机」阶段（第三阶段），让用户先查看确认清单，
  // 再在弹窗内点击「确认」走统一的转商机逻辑（含客户 / 产品建档）
  const handleConvert = (record: Lead) => {
    formModalRef.current?.openEdit(record, 2);
  };

  // 认领公海线索：归到自己名下后才可确认 / 无效
  const handleClaim = useCallback(
    async (r: Lead) => {
      try {
        await leadApi.claim(r.id);
        message.success(t('lead.claimSuccess'));
        list.refresh();
        refetchDetail();
      } catch (err: any) {
        message.error(err?.response?.data?.message || t('lead.claimFailed'));
      }
    },
    [list, message, t, refetchDetail],
  );

  // 释放线索到公海（私海 → 公海）：复用统一确认弹窗（useReleaseToPool）
  const handleRelease = useCallback(
    (r: Lead) => {
      releaseToPool({
        name: r.leadName || r.companyName || '',
        action: () => leadApi.release(r.id),
        onSuccess: () => {
          list.refresh();
          refetchDetail();
        },
      });
    },
    [releaseToPool, list, refetchDetail],
  );

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
        {/* 交互式筛选栏（搜索 + 筛选展开面板 + 排序 + 新建线索），替代原 CTA + 筛选栏 */}
        <FilterToolbar
          searchPlaceholder={t('lead.searchPlaceholder')}
          searchValue={list.keyword}
          onSearchChange={list.setKeyword}
          sortOptions={[
            { value: 'createdAt:desc', label: t('lead.sortLatest') },
            { value: 'createdAt:asc', label: t('lead.sortEarliest') },
          ]}
          sortValue={list.sort}
          onSortChange={(v) => {
            list.setSort(v);
            list.setPage(1);
          }}
          activeCount={
            (list.filterChannel ? 1 : 0) + (list.filterPlatform ? 1 : 0) + (list.filterStatus ? 1 : 0)
          }
          onClear={() => {
            list.setFilterChannel(undefined);
            list.setFilterPlatform(undefined);
            list.setFilterStatus(undefined);
            list.setPage(1);
          }}
          tabs={
            <CapsuleSwitch<'mine' | 'pool'>
              value={list.scope}
              onChange={(val) => {
                list.setScope(val);
                list.setPage(1);
              }}
              options={[
                { key: 'mine', label: t('lead.scopeMine') },
                { key: 'pool', label: t('lead.scopePool') },
              ]}
              activeColor="#1677ff"
            />
          }
          total={list.total}
          actions={
            <>
              {isAdmin && list.selectedKeys.length > 0 && (
                <Popconfirm
                  title={t('lead.batchDeleteConfirm', { n: list.selectedKeys.length })}
                  onConfirm={() => list.batchRemove(list.selectedKeys)}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    {t('common.batchDelete')}
                  </Button>
                </Popconfirm>
              )}
              <Button type="primary" icon={<PlusOutlined />} onClick={() => formModalRef.current?.openCreate()}>
                {t('lead.createTitle')}
              </Button>
            </>
          }
        >
          <FilterGroup
            label={t('lead.filterPlatform')}
            value={list.filterChannel ?? ''}
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
            value={list.filterPlatform ?? ''}
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
            label={t('lead.status')}
            value={list.filterStatus ?? ''}
            onChange={(key) => {
              list.setFilterStatus((key || undefined) as LeadStatus | undefined);
              list.setPage(1);
            }}
            options={[
              { key: '', label: t('common.all') },
              ...Object.entries(STATUS_META).map(([k, m]) => ({ key: k, label: t(m.label) })),
            ]}
          />
        </FilterToolbar>

        {/* 卡片列表 + 右侧详情面板（点击卡片联动，参考询盘列表交互） */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', marginTop: 16 }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <LeadCardList
              dataSource={list.listData}
              loading={list.loading}
              selectedId={selectedId}
              onSelect={(r) => setSelectedId((prev) => (prev === r.id ? null : r.id))}
            />
          </div>
          <div className="lead-detail-col">
            <LeadDetailPanel
              detail={detail}
              loading={detailLoading}
              isAdmin={isAdmin}
              onClose={() => {
                setSelectedId(null);
                setDetail(null);
              }}
              onEdit={(r) => formModalRef.current?.openEdit(r)}
              onConvert={handleConvert}
              onClaim={handleClaim}
              onRelease={handleRelease}
              onRemove={handleRemove}
            />
          </div>
        </div>
      </Card>

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

      {/* 新建 / 编辑 / 详情弹窗（含确认建档子弹窗） */}
      <LeadFormModal
        ref={formModalRef}
        channels={channels}
        productOptions={productOptions}
        crafts={crafts}
        audiences={audiences}
        customerOptions={customerOptions}
        onRefreshCustomers={fetchCustomers}
        onRefreshProducts={fetchProducts}
        onSaved={(savedId) => {
          list.refresh();
          // 暂存 / 保存后：新建的草稿或编辑的线索自动选中并刷新右侧详情；其余场景按当前选中项刷新
          if (savedId) setSelectedId(savedId);
          refetchDetail();
        }}
      />
      </div>
  );
}
