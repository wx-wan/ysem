import { useEffect, useRef } from 'react';
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

  // 列表行内状态切换（确认 / 有效 / 无效）
  const handleChangeStatus = async (id: string, status: LeadStatus) => {
    await leadApi.changeStatus(id, status);
    list.refresh();
  };

  // 确认线索 → 转化为商机（检测客户/产品建档，未建档则新建，再建商机并标记「已确认」）
  const handleConvert = (record: Lead) => {
    modal.confirm({
      title: t('lead.confirmConvertTitle'),
      content: t('lead.confirmConvertContent'),
      okText: t('common.ok'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        const res = await convertLeadToOpportunity(record.id, {
          confirmCreate: async (type, name) =>
            new Promise<void>((resolve) => {
              modal.info({
                title: type === 'customer' ? t('lead.createCustomerConfirmTitle') : t('lead.createProductConfirmTitle'),
                content: type === 'customer' ? t('lead.createCustomerConfirmContent', { name }) : t('lead.createProductConfirmContent', { name }),
                okText: t('common.ok'),
                onOk: () => resolve(),
              });
            }),
        });
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
      },
    });
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
    </div>
  );
}
