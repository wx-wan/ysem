import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, Pagination, Button, Popconfirm, App, theme } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
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
import { convertLeadToOpportunity } from '../utils/convertLead';
import { useReleaseToPool } from '../hooks/useReleaseToPool';
import { buildTablePagination } from '../components/common/tablePagination';
import { useAuthStore } from '../stores/useAuthStore';
import { useUserStore } from '../stores/useUserStore';
import CustomerFormModal from '../components/customer/modals/CustomerFormModal';
import ProductEditModal, { type ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import { findCountry } from '../data/countries';
import { type ProductImageItem } from '../utils/productImages';
import ConvertCreateSummaryModal from '../components/lead/ConvertCreateSummaryModal';

export default function SalesLeads() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { modal, message } = App.useApp();

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
  const navigate = useNavigate();

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

  // 转商机强制建档：真实「新建客户 / 新建产品」弹窗（与客户页 / 产品页一致）
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerInitial, setCustomerInitial] = useState<{
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
    images?: ProductImageItem[];
  }>({});
  const productEditRef = useRef<ProductEditModalHandle>(null);
  // 保存待解锁的 Promise（弹窗保存后 resolve 出新记录 id）
  const pendingResolveRef = useRef<((v: { id: string }) => void) | null>(null);
  // 待建档清单汇总弹窗（方案A）
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryItems, setSummaryItems] = useState<{ customerName?: string; productName?: string }>({});
  const summaryResolveRef = useRef<((v: { customerId?: string; productId?: string }) => void) | null>(null);
  const summaryRejectRef = useRef<((e: Error) => void) | null>(null);

  // 未建档客户：弹出「新建客户」弹窗（与客户页一致），保存后 resolve 新 id
  const openCustomerForm = (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
    images?: ProductImageItem[];
  }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      const { companyName, contactName, email, phone, country, images } = initial || {};
      // 线索国家可能是代码/英文名，统一转成中文名以便 CountrySelect 正确选中
      const countryZh = country ? findCountry(country)?.zh : undefined;
      setCustomerInitial({ companyName, contactName, email, phone, country: countryZh, images });
      setCustomerFormOpen(true);
    });

  // 未建档产品：弹出「新建产品」弹窗（与产品页一致），保存后 resolve 新 id
  const openProductForm = (initial?: { name?: string; description?: string; images?: import('../utils/productImages').ProductImageItem[] }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      const { name, description, images } = initial || {};
      productEditRef.current?.open(undefined, { name, description, images }, true);
    });

  // 待建档清单汇总弹窗（方案A）：客户/产品均缺失时，先弹出汇总页，逐项打开真实弹窗建档
  const showCreateSummary = (items: { customerName?: string; productName?: string }) =>
    new Promise<{ customerId?: string; productId?: string }>((resolve, reject) => {
      summaryResolveRef.current = resolve;
      summaryRejectRef.current = reject;
      setSummaryItems(items);
      setSummaryOpen(true);
    });

  // 确认线索 → 转化为商机（检测客户/产品建档，未建档则弹出真实新建弹窗强制建档）
  const handleConvert = (record: Lead) => {
    modal.confirm({
      title: t('lead.confirmConvertTitle'),
      content: t('lead.confirmConvertContent'),
      okText: t('common.ok'),
      cancelText: t('common.cancel'),
      // onOk 不返回 Promise，让确认弹窗立即关闭；convertLead 的建档流程由后续弹窗接管，避免层级堆叠。
      onOk: () => {
        (async () => {
          try {
            const res = await convertLeadToOpportunity(record.id, { openCustomerForm, openProductForm, showCreateSummary });
            const successModal = modal.success({
              title: t('lead.convertSuccessTitle'),
              content: (
                <div>
                  <p>{t('lead.convertSuccessDesc')}</p>
                  <p>
                    {t('lead.convertSuccessPipeline')}：
                    <Button
                      type="link"
                      style={{ padding: 0, height: 'auto', fontWeight: 700 }}
                      onClick={() => {
                        successModal.destroy();
                        navigate('/sales/opportunities');
                      }}
                    >
                      {res.pipeline?.opportunityNo}
                    </Button>
                  </p>
                  {res.customerCreated && <p>{t('lead.convertCreatedCustomer')}</p>}
                  {res.productCreated && <p>{t('lead.convertCreatedProduct')}</p>}
                </div>
              ),
            });
            list.refresh();
            refetchDetail();
          } catch {
            // convertLead 内部已 message.error，此处仅吞掉异常避免 unhandled rejection
          }
        })();
      },
    });
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

  // 「新建客户」弹窗（强制建档）保存成功
  const handleCustomerFormSuccess = (customer?: { id: string }) => {
    setCustomerFormOpen(false);
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    if (resolve && customer?.id) resolve({ id: customer.id });
  };

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
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginTop: 16 }}>
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
        onSaved={() => {
          list.refresh();
          refetchDetail();
        }}
      />

      {/* 转商机时未检测到客户：弹出「新建客户」弹窗（与客户页一致），强制建档 */}
      <CustomerFormModal
        open={customerFormOpen}
        editingCustomer={null}
        initialCompanyName={customerInitial.companyName}
        initialContactName={customerInitial.contactName}
        initialEmail={customerInitial.email}
        initialPhone={customerInitial.phone}
        initialCountry={customerInitial.country}
        initialImages={customerInitial.images}
        force
        onClose={() => setCustomerFormOpen(false)}
        onSuccess={handleCustomerFormSuccess}
      />

      {/* 转商机时未检测到产品：弹出「新建产品」弹窗（与产品页一致），强制建档 */}
      <ProductEditModal
        ref={productEditRef}
        crafts={crafts}
        audiences={audiences}
        onSuccess={(saved) => {
          const resolve = pendingResolveRef.current;
          pendingResolveRef.current = null;
          if (resolve && saved?.id) resolve({ id: saved.id });
        }}
      />

      {/* 转商机·待建档清单汇总页（客户/产品均缺失时，逐项打开真实弹窗强制建档） */}
      <ConvertCreateSummaryModal
        open={summaryOpen}
        items={summaryItems}
        onOpenCustomer={openCustomerForm}
        onOpenProduct={openProductForm}
        onCancel={() => {
          setSummaryOpen(false);
          summaryRejectRef.current?.(new Error('cancelled'));
          summaryRejectRef.current = null;
          summaryResolveRef.current = null;
        }}
        onConfirm={(ids) => {
          setSummaryOpen(false);
          const resolve = summaryResolveRef.current;
          summaryResolveRef.current = null;
          summaryRejectRef.current = null;
          resolve?.(ids);
        }}
      />
      </div>
  );
}
