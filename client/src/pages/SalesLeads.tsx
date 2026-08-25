import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Drawer, Form, Pagination,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  EyeOutlined, EditOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { theme } from 'antd';
import { leadApi, type Lead, type LeadStatus, type LeadPayload, type LeadSource } from '../api/lead';
import { channelApi, type Channel } from '../api/channel';
import { customerApi, type Customer } from '../api/customers';
import { buildTablePagination } from '../components/common/tablePagination';
import { useTranslation } from 'react-i18next';

const STATUS_META: Record<LeadStatus, { color: string; label: string }> = {
  NEW: { color: 'blue', label: 'lead.statusNew' },
  CONTACTED: { color: 'cyan', label: 'lead.statusContacted' },
  QUALIFIED: { color: 'gold', label: 'lead.statusQualified' },
  INVALID: { color: 'default', label: 'lead.statusInvalid' },
  CONVERTED: { color: 'green', label: 'lead.statusConverted' },
};

const SOURCE_META: Record<LeadSource, { color: string; label: string }> = {
  MANUAL: { color: 'default', label: 'lead.sourceManual' },
  EXCEL: { color: 'purple', label: 'lead.sourceExcel' },
  RPA: { color: 'geekblue', label: 'lead.sourceRpa' },
  SYNC: { color: 'cyan', label: 'lead.sourceSync' },
};

export default function SalesLeads() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { token } = theme.useToken();

  const [listData, setListData] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterChannel, setFilterChannel] = useState<string | undefined>();
  const [filterShop, setFilterShop] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<LeadStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(19);

  // 渠道下拉（平台 -> 店铺）
  const [channels, setChannels] = useState<Channel[]>([]);

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form] = Form.useForm();
  const [customerOptions, setCustomerOptions] = useState<{ label: string; value: string }[]>([]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await channelApi.list();
      setChannels(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await customerApi.listAll({ pageSize: 9999 });
      setCustomerOptions((res.data.data.list || []).map((c: Customer) => ({ label: c.companyName, value: c.id })));
    } catch { /* ignore */ }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadApi.list({
        page, pageSize,
        keyword: keyword || undefined,
        channelId: filterChannel,
        shopId: filterShop,
        status: filterStatus,
      });
      setListData(res.data.list);
      setTotal(res.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterShop, filterStatus, message, t]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const refresh = () => fetchList();

  // ============ 操作 ============
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'NEW', source: 'MANUAL' });
    fetchCustomers();
    setDrawerOpen(true);
  };

  const openEdit = async (record: Lead) => {
    setEditing(record);
    fetchCustomers();
    try {
      const res = await leadApi.get(record.id);
      const item = res.data;
      form.setFieldsValue({
        leadName: item.leadName,
        customerId: item.customerId,
        channelId: item.channelId,
        shopId: item.shopId,
        source: item.source,
        status: item.status,
        companyName: item.companyName,
        contactName: item.contactName,
        email: item.email,
        phone: item.phone,
        country: item.country,
        productInterest: item.productInterest,
        remark: item.remark,
        assignedTo: item.assignedTo,
      });
    } catch { /* ignore */ }
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload: LeadPayload = {
      leadName: values.leadName,
      customerId: values.customerId || null,
      channelId: values.channelId || null,
      shopId: values.shopId || null,
      source: values.source || 'MANUAL',
      status: values.status || 'NEW',
      companyName: values.companyName,
      contactName: values.contactName,
      email: values.email,
      phone: values.phone,
      country: values.country,
      productInterest: values.productInterest,
      remark: values.remark,
      assignedTo: values.assignedTo || null,
    };
    try {
      if (editing) {
        await leadApi.update(editing.id, payload);
        message.success(t('common.updateSuccess'));
      } else {
        await leadApi.create(payload);
        message.success(t('common.createSuccess'));
      }
      setDrawerOpen(false);
      refresh();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  const remove = async (id: string) => {
    try {
      await leadApi.delete(id);
      message.success(t('common.deleteSuccess'));
      refresh();
    } catch {
      message.error(t('common.deleteFailed'));
    }
  };

  const changeStatus = async (id: string, status: LeadStatus) => {
    try {
      await leadApi.changeStatus(id, status);
      message.success(t('lead.statusUpdated'));
      refresh();
    } catch {
      message.error(t('common.updateFailed'));
    }
  };

  const channelOptions = channels.filter((c) => !c.parentId);
  const shopOptionsFor = (platformId?: string) =>
    channels.filter((c) => c.parentId === platformId);

  const columns: ColumnsType<Lead> = useMemo(() => [
    {
      title: t('lead.name'),
      dataIndex: 'leadName',
      width: 200,
      ellipsis: true,
      render: (v: string, r) => (
        <a onClick={() => openEdit(r)}>{v}</a>
      ),
    },
    {
      title: t('lead.customer'),
      width: 160,
      render: (_: unknown, r) => {
        if (r.customer) return r.customer.companyName || r.customer.contactName || '-';
        return r.companyName || '-';
      },
    },
    {
      title: t('lead.channel'),
      width: 180,
      render: (_: unknown, r) => (
        <Space size={4}>
          {r.channel && <Tag color="blue">{r.channel.name}</Tag>}
          {r.shop && <Tag>{r.shop.name}</Tag>}
          {!r.channel && !r.shop && '-'}
        </Space>
      ),
    },
    {
      title: t('lead.source'),
      dataIndex: 'source',
      width: 100,
      render: (s: LeadSource) => <Tag color={SOURCE_META[s]?.color}>{t(SOURCE_META[s]?.label)}</Tag>,
    },
    {
      title: t('lead.status'),
      dataIndex: 'status',
      width: 110,
      render: (s: LeadStatus, r) => (
        <Select
          size="small"
          value={s}
          variant="borderless"
          style={{ width: 92 }}
          onChange={(v) => changeStatus(r.id, v)}
          options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: t(m.label) }))}
        />
      ),
    },
    {
      title: t('lead.assignee'),
      dataIndex: 'assignedTo',
      width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: t('lead.createdAt'),
      dataIndex: 'createdAt',
      width: 120,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_: unknown, r) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openEdit(r)}>
            {t('common.detail')}
          </Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => remove(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [t]);

  return (
    <div>
      <Card
        variant="borderless"
        style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}
      >
        {/* 新建区块 */}
        <div
          onClick={openCreate}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, padding: '14px 18px', marginBottom: 16,
            borderRadius: token.borderRadius, cursor: 'pointer',
            background: `linear-gradient(90deg, ${token.colorPrimaryBg} 0%, ${token.colorPrimaryBgHover} 100%)`,
            border: `1px dashed ${token.colorPrimary}`,
            transition: 'all .2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderStyle = 'solid'; e.currentTarget.style.boxShadow = `0 2px 12px ${token.colorPrimaryBg}`; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderStyle = 'dashed'; e.currentTarget.style.boxShadow = 'none'; }}
        >
          <Space size={10}>
            <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, background: token.colorPrimary, color: '#fff', fontSize: 16 }}>
              <PlusOutlined />
            </span>
            <div style={{ lineHeight: 1.3 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{t('lead.createTitle')}</div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('lead.createDesc')}</div>
            </div>
          </Space>
        </div>

        {/* 筛选栏 */}
        <div
          style={{
            padding: '16px 20px', borderBottom: `1px dashed ${token.colorBorderSecondary}`,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 16,
          }}
        >
          <Space wrap>
            <Select
              style={{ width: 150 }}
              placeholder={t('lead.filterPlatform')}
              allowClear
              value={filterChannel}
              onChange={(v) => { setFilterChannel(v); setFilterShop(undefined); setPage(1); }}
              options={channelOptions.map((c) => ({ label: c.name, value: c.id }))}
            />
            <Select
              style={{ width: 140 }}
              placeholder={t('lead.filterShop')}
              allowClear
              disabled={!filterChannel}
              value={filterShop}
              onChange={(v) => { setFilterShop(v); setPage(1); }}
              options={shopOptionsFor(filterChannel).map((c) => ({ label: c.name, value: c.id }))}
            />
            <Select
              style={{ width: 120 }}
              placeholder={t('lead.filterStatus')}
              allowClear
              value={filterStatus}
              onChange={(v) => { setFilterStatus(v); setPage(1); }}
              options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: t(m.label) }))}
            />
            <Input
              style={{ width: 200 }}
              placeholder={t('lead.searchPlaceholder')}
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => { setPage(1); refresh(); }}
            />
            <Button onClick={() => { setPage(1); refresh(); }}>{t('common.search')}</Button>
            <Button icon={<ReloadOutlined />} onClick={refresh}>{t('common.refresh')}</Button>
          </Space>
          <Space>
            {selectedKeys.length > 0 && (
              <Popconfirm title={t('lead.batchDeleteConfirm', { n: selectedKeys.length })} onConfirm={() => {
                Promise.all(selectedKeys.map((id) => leadApi.delete(id)))
                  .then(() => { message.success(t('common.deleteSuccess')); setSelectedKeys([]); refresh(); })
                  .catch(() => message.error(t('common.deleteFailed')));
              }}>
                <Button danger icon={<DeleteOutlined />}>{t('common.batchDelete')}</Button>
              </Popconfirm>
            )}
          </Space>
        </div>

        <Table<Lead>
          rowKey="id"
          columns={columns}
          dataSource={listData}
          loading={loading}
          size="middle"
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
          scroll={{ x: 1000 }}
          pagination={false}
        />
      </Card>

      {total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
          <Pagination
            {...buildTablePagination({ total, page, pageSize, onChange: (p, s) => { setPage(p); setPageSize(s); } })}
          />
        </div>
      )}

      {/* 新建 / 详情抽屉 */}
      <Drawer
        title={editing ? t('lead.editTitle') : t('lead.createTitle')}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={submit}>{t('common.save')}</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="leadName" label={t('lead.name')} rules={[{ required: true, message: t('lead.nameRequired') }]}>
            <Input placeholder={t('lead.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="customerId" label={t('lead.customer')}>
            <Select
              showSearch
              allowClear
              placeholder={t('lead.customerPlaceholder')}
              optionFilterProp="label"
              options={customerOptions}
            />
          </Form.Item>
          <Form.Item label={t('lead.channel')}>
            <Space.Compact style={{ display: 'flex' }}>
              <Form.Item name="channelId" noStyle>
                <Select
                  style={{ width: '50%' }}
                  placeholder={t('lead.filterPlatform')}
                  allowClear
                  onChange={() => form.setFieldValue('shopId', undefined)}
                  options={channelOptions.map((c) => ({ label: c.name, value: c.id }))}
                />
              </Form.Item>
              <Form.Item name="shopId" noStyle>
                <Select
                  style={{ width: '50%' }}
                  placeholder={t('lead.filterShop')}
                  allowClear
                  options={(channels.filter((c) => c.parentId === form.getFieldValue('channelId'))).map((c) => ({ label: c.name, value: c.id }))}
                />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="source" label={t('lead.source')} rules={[{ required: true }]}>
            <Select options={Object.entries(SOURCE_META).map(([k, m]) => ({ value: k, label: t(m.label) }))} />
          </Form.Item>
          <Form.Item name="status" label={t('lead.status')} rules={[{ required: true }]}>
            <Select options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: t(m.label) }))} />
          </Form.Item>
          <Form.Item name="companyName" label={t('lead.companyName')}>
            <Input />
          </Form.Item>
          <Form.Item name="contactName" label={t('lead.contactName')}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label={t('lead.email')}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label={t('lead.phone')}>
            <Input />
          </Form.Item>
          <Form.Item name="country" label={t('lead.country')}>
            <Input />
          </Form.Item>
          <Form.Item name="productInterest" label={t('lead.productInterest')}>
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="remark" label={t('lead.remark')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="assignedTo" label={t('lead.assignee')}>
            <Input placeholder={t('lead.assigneePlaceholder')} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
