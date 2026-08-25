import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Button, Space, Input, InputNumber, Select, AutoComplete, Table, Tag, Popconfirm, App, Form, Pagination, Row, Col,
} from 'antd';
import AppModal from '../components/AppModal';
import { productApi, taxonomyApi, type ProductOption, type ProductCraft, type ProductAudience, type Product } from '../api/products';
import CustomerFormModal from '../components/customer/modals/CustomerFormModal';
import { ProductEditModal, type ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  EyeOutlined, EditOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { theme } from 'antd';
import { leadApi, type Lead, type LeadStatus, type LeadPayload, type LeadSource } from '../api/lead';
import { channelApi, type Channel } from '../api/channel';
import { customerApi, type Customer } from '../api/customers';
import { userApi, type UserSelectItem } from '../api/users';
import { useAuthStore } from '../stores/useAuthStore';
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
  const [filterPlatform, setFilterPlatform] = useState<string | undefined>();
  const [filterStatus, setFilterStatus] = useState<LeadStatus | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(19);

  // 来源渠道（渠道树，展平为选项）
  const [channels, setChannels] = useState<Channel[]>([]);
  // 采购产品选项（产品模块简化版：下拉选择，后续支持一键新建产品）
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  // 产品建档弹窗所需分类数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  // 「确认建档」弹窗：客户走新建客户弹窗、产品走新建产品弹窗
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [initialCustName, setInitialCustName] = useState('');
  const productEditRef = useRef<ProductEditModalHandle>(null);

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [form] = Form.useForm();
  const [customerOptions, setCustomerOptions] = useState<{ label: string; value: string; contactName?: string; customerCode?: string }[]>([]);

  // 当前登录用户（新建线索时负责人默认取当前用户）
  const currentUser = useAuthStore((s) => s.user);
  // 仅管理员可删除线索
  const isAdmin = currentUser?.role?.code === 'admin';
  // 可选负责人列表
  const [userOptions, setUserOptions] = useState<UserSelectItem[]>([]);
  const userNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    userOptions.forEach((u) => { m[u.id] = u.realName || u.username; });
    return m;
  }, [userOptions]);
  const fetchUsers = useCallback(async () => {
    try {
      const res = await userApi.listForSelect();
      setUserOptions(res.data.data || []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const fetchChannels = useCallback(async () => {
    try {
      const res = await channelApi.tree();
      setChannels(res.data);
    } catch { /* ignore */ }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await productApi.options();
      setProductOptions(res.data.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchTaxonomy = useCallback(async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        taxonomyApi.getCrafts(),
        taxonomyApi.getAudiences(),
      ]);
      if (cRes.data.code === 200 || cRes.data.code === 0) setCrafts(cRes.data.data);
      if (aRes.data.code === 200 || aRes.data.code === 0) setAudiences(aRes.data.data);
    } catch { /* ignore */ }
  }, []);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await customerApi.listAll({ pageSize: 9999 });
      setCustomerOptions(
        (res.data.data.list || []).map((c: Customer) => ({
          label: c.companyName,
          value: c.id,
          contactName: c.contactName || undefined,
          customerCode: c.customerCode || undefined,
        })),
      );
    } catch { /* ignore */ }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await leadApi.list({
        page, pageSize,
        keyword: keyword || undefined,
        channel: filterChannel,
        platform: filterPlatform,
        status: filterStatus,
      });
      setListData(res.data.list);
      setTotal(res.data.total);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterChannel, filterPlatform, filterStatus, message, t]);

  useEffect(() => {
    fetchChannels();
    fetchProducts();
    fetchTaxonomy();
  }, [fetchChannels, fetchProducts, fetchTaxonomy]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const refresh = () => fetchList();

  // ============ 操作 ============
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    // 负责人默认当前创建人（来源/状态由系统判定，无需选择）
    form.setFieldsValue({ assignedTo: currentUser?.id });
    fetchCustomers();
    fetchUsers();
    setDrawerOpen(true);
  };

  const openEdit = async (record: Lead) => {
    setEditing(record);
    fetchCustomers();
    try {
      const res = await leadApi.get(record.id);
      const item = res.data;
      // 来源渠道回填：若为「渠道 / 平台」路径则拆分，渠道自动带出
      const sourceParts = (item.sourceChannel || '').split(' / ');
      form.setFieldsValue({
        customerKey: item.customer?.companyName || item.companyName || undefined,
        channel: sourceParts.length > 1 ? sourceParts[0] : item.sourceChannel || '',
        sourceChannel: item.sourceChannel || undefined,
        productKey: item.product?.name || item.productName || undefined,
        quantity: item.quantity ?? undefined,
        remark: item.remark,
        assignedTo: item.assignedTo,
      });
    } catch { /* ignore */ }
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    // 客户：可手输新客户名，或下拉选择已有客户；手输新名仅存文本，确认后才会建档
    let customerId: string | null = null;
    let companyName: string | undefined;
    const customerName = values.customerKey?.trim();
    if (customerName) {
      const matched = customerOptions.find((c) => c.label === customerName);
      if (matched) {
        customerId = matched.value;
      } else {
        companyName = customerName;
      }
    }
    // 采购产品：可手输新产品名，或下拉选择已有产品；手输新名仅存文本，确认后才会建档
    let productId: string | null = null;
    let productName: string | undefined;
    const productNameInput = values.productKey?.trim();
    if (productNameInput) {
      const matched = productOptions.find((p) => p.name === productNameInput);
      if (matched) {
        productId = matched.id;
      } else {
        productName = productNameInput;
      }
    }
    const payload: LeadPayload = {
      leadName: leadNamePreview,
      customerId,
      companyName,
      sourceChannel: values.sourceChannel || values.channel || null,
      productId,
      productName,
      quantity: values.quantity ?? 0,
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

  // 确认建档：走「新建客户 / 新建产品」弹窗，带入待确认的名称，由用户在弹窗中补全并确认后创建
  const confirmCreateCustomer = () => {
    if (!editing?.companyName) return;
    setInitialCustName(editing.companyName);
    setCustModalOpen(true);
  };

  const confirmCreateProduct = () => {
    if (!editing?.productName) return;
    productEditRef.current?.open(null, { name: editing.productName ?? '' });
  };

  // 新建客户弹窗保存成功后：关联到当前线索
  const handleCustomerFiled = async (customer?: Customer) => {
    if (!customer?.id || !editing) return;
    try {
      await leadApi.update(editing.id, { customerId: customer.id, companyName: null });
      message.success(t('common.createSuccess'));
      fetchCustomers();
      refresh();
      setEditing({ ...editing, customerId: customer.id, companyName: null });
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 新建产品弹窗保存成功后：关联到当前线索
  const handleProductFiled = async (saved?: Product) => {
    if (!saved?.id || !editing) return;
    try {
      await leadApi.update(editing.id, { productId: saved.id, productName: null });
      message.success(t('common.createSuccess'));
      fetchProducts();
      refresh();
      setEditing({ ...editing, productId: saved.id, productName: null });
    } catch {
      message.error(t('common.saveFailed'));
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

  // 渠道选项（根节点，如 国际站 / 线下渠道）
  const channelOptions = useMemo(
    () => channels.map((c) => ({ label: c.name, value: c.name })),
    [channels],
  );

  // 平台选项：选中渠道后只列其下平台；未选渠道则列出所有平台（带渠道前缀区分）
  const platformOptions = useMemo(() => {
    const opts: { label: string; value: string }[] = [];
    const collect = (node: Channel) => {
      (node.children || []).forEach((child) => {
        opts.push({ label: `${node.name} / ${child.name}`, value: child.name });
      });
    };
    if (filterChannel) {
      const node = channels.find((c) => c.name === filterChannel);
      if (node) collect(node);
    } else {
      channels.forEach(collect);
    }
    return opts;
  }, [channels, filterChannel]);

  // 表单平台选项：随所选渠道联动（先选渠道，再选平台）
  const selectedChannel = Form.useWatch('channel', form);
  const formPlatformOptions = useMemo(() => {
    if (!selectedChannel) return [];
    const node = channels.find((c) => c.name === selectedChannel);
    const children = node?.children || [];
    // 渠道无平台时，兜底可选渠道本身
    if (!children.length) return [{ label: selectedChannel, value: selectedChannel, title: selectedChannel }];
    return children.map((child) => ({
      label: child.name,
      value: `${selectedChannel} / ${child.name}`,
      title: `${selectedChannel} / ${child.name}`,
    }));
  }, [channels, selectedChannel]);

  // 线索名称自动生成：渠道-平台-采购产品-数量
  const watchChannel = Form.useWatch('channel', form);
  const watchSourceChannel = Form.useWatch('sourceChannel', form);
  const watchProductKey = Form.useWatch('productKey', form);
  const watchQuantity = Form.useWatch('quantity', form);
  const leadNamePreview = useMemo(() => {
    const parts: string[] = [];
    if (watchChannel) parts.push(watchChannel);
    if (watchSourceChannel) {
      // 平台值可能为「渠道 / 平台」路径，取平台段；平台等于渠道（无子平台兜底）时省略
      const platform = watchSourceChannel.split(' / ').pop() || '';
      if (platform && platform !== watchChannel) parts.push(platform);
    }
    if (watchProductKey) parts.push(watchProductKey);
    if (watchQuantity !== undefined && watchQuantity !== null) parts.push(String(watchQuantity));
    return parts.join('-');
  }, [watchChannel, watchSourceChannel, watchProductKey, watchQuantity]);

  // 客户/产品 AutoComplete 选项：以名称为值，支持手输或下拉选择
  // 客户下拉展示「公司名 · 联系人 · 编号」，搜索按整个文本模糊匹配
  const customerNameOptions = useMemo(
    () =>
      customerOptions.map((c) => ({
        value: c.label,
        label: [
          c.label,
          c.contactName ? `${t('lead.customerContact')}：${c.contactName}` : '',
          c.customerCode ? `${t('lead.customerNo')}：${c.customerCode}` : '',
        ].filter(Boolean).join(' · '),
      })),
    [customerOptions, t],
  );
  const productNameOptions = useMemo(
    () => productOptions.map((p) => ({ label: p.name, value: p.name })),
    [productOptions],
  );

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
        if (r.companyName) {
          return (
            <span>
              {r.companyName}
              <Tag color="orange" style={{ marginLeft: 6 }}>
                {t('lead.pendingTag')}
              </Tag>
            </span>
          );
        }
        return '-';
      },
    },
    {
      title: t('lead.channel'),
      dataIndex: 'sourceChannel',
      width: 180,
      ellipsis: true,
      render: (v?: string) => v || '-',
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
      render: (s: LeadStatus) => <Tag color={STATUS_META[s]?.color}>{t(STATUS_META[s]?.label)}</Tag>,
    },
    {
      title: t('lead.assignee'),
      dataIndex: 'assignedTo',
      width: 100,
      ellipsis: true,
      render: (v?: string, r?: Lead) => {
        if (r?.assignedUser) return r.assignedUser.realName || r.assignedUser.username;
        return (v && userNameMap[v]) || v || '-';
      },
    },
    {
      title: t('lead.createdAt'),
      dataIndex: 'createdAt',
      width: 120,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_: unknown, r) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => openEdit(r)}>
            {t('common.detail')}
          </Button>
          {isAdmin && (
            <Popconfirm title={t('common.confirmDelete')} onConfirm={() => remove(r.id)}>
              <Button size="small" type="link" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, isAdmin]);

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
              style={{ width: 160 }}
              placeholder={t('lead.filterPlatform')}
              allowClear
              showSearch
              optionFilterProp="label"
              value={filterChannel}
              onChange={(v) => { setFilterChannel(v); setFilterPlatform(undefined); setPage(1); }}
              options={channelOptions}
            />
            <Select
              style={{ width: 180 }}
              placeholder={t('lead.filterShop')}
              allowClear
              showSearch
              optionFilterProp="label"
              value={filterPlatform}
              onChange={(v) => { setFilterPlatform(v); setPage(1); }}
              options={platformOptions}
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
            {isAdmin && selectedKeys.length > 0 && (
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

      {/* 新建 / 编辑弹窗 */}
      <AppModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? t('lead.editTitle') : t('lead.createTitle')}
        width={560}
        bodyPadding={20}
        footer={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={submit}>{t('common.save')}</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item label={t('lead.name')} required>
            <Input
              value={leadNamePreview}
              readOnly
              placeholder={t('lead.nameAutoPlaceholder')}
              style={{ color: 'rgba(0, 0, 0, 0.65)', background: '#f5f5f5', cursor: 'not-allowed' }}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="channel" label={t('lead.channel')} rules={[{ required: true, message: t('lead.channelRequired') }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder={t('lead.filterPlatform')}
                  optionFilterProp="label"
                  options={channelOptions}
                  onChange={() => form.setFieldsValue({ sourceChannel: undefined })}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sourceChannel" label={t('lead.platform')} rules={[{ required: true, message: t('lead.platformRequired') }]}>
                <Select
                  showSearch
                  allowClear
                  disabled={!selectedChannel}
                  placeholder={t('lead.filterShop')}
                  optionFilterProp="label"
                  options={formPlatformOptions}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="customerKey"
            label={t('lead.customer')}
            rules={[{ required: true, message: t('lead.customerRequired') }]}
          >
            <AutoComplete
              allowClear
              placeholder={t('lead.customerPlaceholder')}
              options={customerNameOptions}
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="productKey"
                label={t('lead.product')}
                rules={[{ required: true, message: t('lead.productRequired') }]}
              >
                <AutoComplete
                  allowClear
                  placeholder={t('lead.productPlaceholder')}
                  options={productNameOptions}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quantity" label={t('lead.quantity')} rules={[{ required: true, message: t('lead.quantityRequired') }]}>
                <InputNumber min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label={t('lead.remark')}>
            <Input.TextArea rows={3} />
          </Form.Item>
          {(editing?.companyName && !editing.customerId) || (editing?.productName && !editing.productId) ? (
            <div
              style={{
                marginBottom: 16,
                padding: '10px 12px',
                background: '#fffbe6',
                border: '1px solid #ffe58f',
                borderRadius: 6,
              }}
            >
              {editing.companyName && !editing.customerId && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: '#ad6800' }}>{t('lead.customerPendingTip', { name: editing.companyName })}</span>
                  <Button size="small" type="primary" ghost onClick={confirmCreateCustomer}>
                    {t('lead.createCustomerNow')}
                  </Button>
                </div>
              )}
              {editing.companyName && !editing.customerId && editing.productName && !editing.productId ? (
                <div style={{ height: 8 }} />
              ) : null}
              {editing.productName && !editing.productId && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: '#ad6800' }}>{t('lead.productPendingTip', { name: editing.productName })}</span>
                  <Button size="small" type="primary" ghost onClick={confirmCreateProduct}>
                    {t('lead.createProductNow')}
                  </Button>
                </div>
              )}
            </div>
          ) : null}
          <Form.Item name="assignedTo" label={t('lead.assignee')}>
            <Select
              showSearch
              allowClear
              placeholder={t('lead.assigneePlaceholder')}
              optionFilterProp="label"
              options={userOptions.map((u) => ({ label: u.realName || u.username, value: u.id }))}
            />
          </Form.Item>
        </Form>
      </AppModal>

      {/* 确认建档：新建客户弹窗（带入待确认客户名到公司名称） */}
      <CustomerFormModal
        open={custModalOpen}
        editingCustomer={null}
        initialCompanyName={initialCustName}
        onClose={() => setCustModalOpen(false)}
        onSuccess={handleCustomerFiled}
      />

      {/* 确认建档：新建产品弹窗（带入待确认产品名到产品名称） */}
      <ProductEditModal
        ref={productEditRef}
        crafts={crafts}
        audiences={audiences}
        onSuccess={handleProductFiled}
      />
    </div>
  );
}
