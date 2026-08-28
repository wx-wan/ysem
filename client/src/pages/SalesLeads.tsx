import { useEffect, useRef, useState } from 'react';
import { Card, Pagination, Button, App, theme } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LeadCreateCard from '../components/lead/LeadCreateCard';
import LeadFilterBar from '../components/lead/LeadFilterBar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import LeadFormModal, { type LeadFormModalHandle } from '../components/lead/LeadFormModal';
import LeadTable from '../components/lead/LeadTable';
import { useLeadList } from '../components/lead/useLeadList';
import { useLeadOptions } from '../components/lead/useLeadOptions';
import { leadApi, type Lead, type LeadStatus } from '../api/lead';
import { convertLeadToOpportunity } from '../utils/convertLead';
import { buildTablePagination } from '../components/common/tablePagination';
import { useAuthStore } from '../stores/useAuthStore';
import { useUserStore } from '../stores/useUserStore';
import CustomerFormModal from '../components/customer/modals/CustomerFormModal';
import ProductEditModal, { type ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import ConvertCreateSummaryModal from '../components/lead/ConvertCreateSummaryModal';

export default function SalesLeads() {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const { modal } = App.useApp();

  // 用户 / 权限
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role?.code === 'admin';
  const fetchUsers = useUserStore((s) => s.fetchUsers);
  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // 列表数据 + 筛选 + 分页
  const list = useLeadList();
  // 表单选项数据（渠道 / 产品 / 分类 / 客户）
  const { channels, productOptions, crafts, audiences, customerOptions, fetchCustomers, fetchProducts } =
    useLeadOptions();

  const formModalRef = useRef<LeadFormModalHandle>(null);
  const navigate = useNavigate();

  // 转商机强制建档：真实「新建客户 / 新建产品」弹窗（与客户页 / 产品页一致）
  const [customerFormOpen, setCustomerFormOpen] = useState(false);
  const [customerInitial, setCustomerInitial] = useState<{ companyName?: string }>({});
  const productEditRef = useRef<ProductEditModalHandle>(null);
  // 保存待解锁的 Promise（弹窗保存后 resolve 出新记录 id）
  const pendingResolveRef = useRef<((v: { id: string }) => void) | null>(null);
  // 待建档清单汇总弹窗（方案A）
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryItems, setSummaryItems] = useState<{ customerName?: string; productName?: string }>({});
  const summaryResolveRef = useRef<((v: { customerId?: string; productId?: string }) => void) | null>(null);
  const summaryRejectRef = useRef<((e: Error) => void) | null>(null);

  // 列表行内状态切换（确认 / 有效 / 无效）
  const handleChangeStatus = async (id: string, status: LeadStatus) => {
    await leadApi.changeStatus(id, status);
    list.refresh();
  };

  // 未建档客户：弹出「新建客户」弹窗（与客户页一致），保存后 resolve 新 id
  const openCustomerForm = (initial: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      setCustomerInitial({ companyName: initial.companyName });
      setCustomerFormOpen(true);
    });

  // 未建档产品：弹出「新建产品」弹窗（与产品页一致），保存后 resolve 新 id
  const openProductForm = (initial: { name?: string; description?: string }) =>
    new Promise<{ id: string }>((resolve) => {
      pendingResolveRef.current = resolve;
      productEditRef.current?.open(undefined, { name: initial.name, description: initial.description }, true);
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
                      {res.pipeline?.pipelineNumber}
                    </Button>
                  </p>
                  {res.customerCreated && <p>{t('lead.convertCreatedCustomer')}</p>}
                  {res.productCreated && <p>{t('lead.convertCreatedProduct')}</p>}
                </div>
              ),
            });
            list.refresh();
          } catch {
            // convertLead 内部已 message.error，此处仅吞掉异常避免 unhandled rejection
          }
        })();
      },
    });
  };

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
        <LeadCreateCard onClick={() => formModalRef.current?.openCreate()} />

        <LeadFilterBar
          prepend={
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
            />
          }
          channels={channels}
          keyword={list.keyword}
          onKeywordChange={list.setKeyword}
          filterChannel={list.filterChannel}
          onChannelChange={(v) => {
            list.setFilterChannel(v);
            list.setFilterPlatform(undefined);
            list.setPage(1);
          }}
          filterPlatform={list.filterPlatform}
          onPlatformChange={(v) => {
            list.setFilterPlatform(v);
            list.setPage(1);
          }}
          filterStatus={list.filterStatus}
          onStatusChange={(v) => {
            list.setFilterStatus(v);
            list.setPage(1);
          }}
          onSearch={() => {
            list.setPage(1);
            list.refresh();
          }}
          onRefresh={list.refresh}
          isAdmin={isAdmin}
          selectedCount={list.selectedKeys.length}
          onBatchDelete={() => list.batchRemove(list.selectedKeys)}
        />

        <LeadTable
          dataSource={list.listData}
          loading={list.loading}
          selectedKeys={list.selectedKeys}
          onSelectionChange={(keys) => list.setSelectedKeys(keys)}
          isAdmin={isAdmin}
          onEdit={(r) => formModalRef.current?.openEdit(r)}
          onRemove={list.remove}
          onChangeStatus={handleChangeStatus}
          onConvert={handleConvert}
        />
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
        onSaved={list.refresh}
      />

      {/* 转商机时未检测到客户：弹出「新建客户」弹窗（与客户页一致），强制建档 */}
      <CustomerFormModal
        open={customerFormOpen}
        editingCustomer={null}
        initialCompanyName={customerInitial.companyName}
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
