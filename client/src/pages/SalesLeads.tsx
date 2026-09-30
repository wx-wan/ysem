import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Pagination, Button, Popconfirm, App, theme } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import FilterToolbar, { FilterGroup } from '../components/common/FilterToolbar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import LeadFormModal, { type LeadFormModalHandle } from '../components/lead/LeadFormModal';
import LeadCardList from '../components/lead/LeadCardList';
import LeadDetailPanel from '../components/lead/LeadDetailPanel';
import { useLeadList, type LeadListTab } from '../components/lead/useLeadList';
import { useLeadOptions } from '../components/lead/useLeadOptions';
import { leadApi, type Lead } from '../api/lead';
import { flattenChannelOptions, flattenPlatformOptions } from '../components/lead/constants';
import { useReleaseToPool } from '../hooks/useReleaseToPool';
import { buildTablePagination } from '../components/common/tablePagination';
import { useAuthStore } from '../stores/useAuthStore';
import { useUserStore } from '../stores/useUserStore';
import { debounce } from '../utils/rateLimit';
import { resolveLeadCustomer } from '../utils/leadCustomer';
import { useSearchParams } from 'react-router-dom';

export default function SalesLeads() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { message } = App.useApp();

  // 用户 / 权限
  const currentUser = useAuthStore((s) => s.user);
  // 与后端口径对齐：后端列表 isAdmin 认 'admin' | 'ADMIN'，此处同样大小写不敏感
  const isAdmin = currentUser?.role?.code?.toLowerCase() === 'admin';
  const fetchUsers = useUserStore((s) => s.fetchUsers);
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 列表数据 + 筛选 + 分页（切换栏 = 新线索 / 已确认 / 公海）
  const list = useLeadList(isAdmin);
  // 关键词搜索：本地输入态即时回显，防抖提交到列表 hook，避免逐字触发列表请求
  const [kw, setKw] = useState(list.keyword ?? '');
  const setKeywordRef = useRef(list.setKeyword);
  setKeywordRef.current = list.setKeyword;
  const commitKeyword = useMemo(() => debounce((v: string) => setKeywordRef.current(v), 400), []);
  useEffect(() => {
    setKw(list.keyword ?? '');
  }, [list.keyword]);
  const onSearchChange = (v: string) => {
    setKw(v);
    commitKeyword(v);
  };
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

  // 右侧详情面板只在「主动点击卡片」或「深链定位（?leadId=）」时展开；
  // 不自动选中第一条 —— 无选中记录时不展示任何详情。

  const [searchParams, setSearchParams] = useSearchParams();
  const leadIdParam = searchParams.get('leadId');
  // 深链：从客户详情「销售记录」点击关联线索时携带 ?leadId= 自动选中并展开详情。
  // 依据线索归属与状态自动切到正确切换栏（新线索 / 已确认 / 公海），确保左侧列表可见该记录；
  // 选中不依赖列表分页，详情按 id 直拉，避免切换切换栏或翻页导致定位丢失。
  const leadResolvedRef = useRef(false);
  useEffect(() => {
    // 必须等当前用户就绪：否则 isAdmin / 归属判定为 false，会把档位误判成「公海」
    if (!leadIdParam || !currentUser || leadResolvedRef.current) return;
    leadResolvedRef.current = true;
    leadApi
      .get(leadIdParam)
      .then((res) => {
        const lead = res.data;
        const mine = lead?.ownerId === currentUser?.id;
        // 非本人且非管理员可见的线索只能在公海找到；其余按状态归入「新线索 / 已确认」
        list.setTab(!mine && !isAdmin ? 'pool' : lead?.status === 'NEW' ? 'new' : 'confirmed');
        setSelectedId(leadIdParam);
        setSearchParams((prev) => {
          prev.delete('leadId');
          return prev;
        }, { replace: true });
      })
      .catch(() => {
        leadResolvedRef.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadIdParam, currentUser]);

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
        name: r.leadName || resolveLeadCustomer(r)?.companyName || '',
        // 规则：线索放弃到公海 ⇒ 关联客户必然一并放归公海（后端强制联动）
        note: r.customerId ? t('lead.releaseCustomerNote') : undefined,
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
          searchValue={kw}
          onSearchChange={onSearchChange}
          sortOptions={[
            { value: 'createdAt:desc', label: t('common.sortLatest') },
            { value: 'createdAt:asc', label: t('common.sortEarliest') },
          ]}
          sortValue={list.sort}
          onSortChange={(v) => {
            list.setSort(v);
            list.setPage(1);
          }}
          activeCount={
            (list.filterChannel ? 1 : 0) + (list.filterPlatform ? 1 : 0)
          }
          onClear={() => {
            list.setFilterChannel(undefined);
            list.setFilterPlatform(undefined);
            list.setPage(1);
          }}
          tabs={
            // 切换栏 = 线索状态档位（默认「新线索」）：「新线索」= 未确认；「已确认」= 已确认及之后；「公海」= 无负责人
            <CapsuleSwitch<LeadListTab>
              value={list.tab}
              onChange={(val) => {
                list.setTab(val);
                list.setPage(1);
                // 切换档位默认关闭已打开的详情（深链定位由 ?leadId= 单独展开）
                setSelectedId(null);
                setDetail(null);
              }}
              options={[
                { key: 'new', label: t('lead.statusNew') },
                { key: 'confirmed', label: t('lead.statusConfirmed') },
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
        </FilterToolbar>

        {/* 卡片列表默认撑满整宽；点击卡片上的「查看详情」后才展开右侧详情面板 */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', marginTop: 16 }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <LeadCardList
              dataSource={list.listData}
              loading={list.loading}
              selectedId={selectedId}
              onSelect={(r) => setSelectedId((prev) => (prev === r.id ? null : r.id))}
            />
          </div>
          {selectedId && (
            <div className="lead-detail-col">
              <LeadDetailPanel
                detail={detail}
                loading={detailLoading}
                isAdmin={isAdmin}
                onClose={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                onEdit={(r, s) => formModalRef.current?.openEdit(r, s)}
                onConvert={handleConvert}
                onClaim={handleClaim}
                onRelease={handleRelease}
                onRemove={handleRemove}
              />
            </div>
          )}
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
