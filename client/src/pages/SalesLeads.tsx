import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Card, Button, Space, Input, InputNumber, Select, AutoComplete, Table, Tag, Popconfirm, App, Form, Pagination, Row, Col, Upload, Image,
} from 'antd';
import AppModal from '../components/AppModal';
import { productApi, taxonomyApi, type ProductOption, type ProductCraft, type ProductAudience, type Product } from '../api/products';
import CustomerFormModal from '../components/customer/modals/CustomerFormModal';
import { ProductEditModal, type ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  EyeOutlined, CheckOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { theme } from 'antd';
import { leadApi, type Lead, type LeadStatus, type LeadPayload, type LeadSource } from '../api/lead';
import { uploadImage } from '../api/request';
import CountrySelect from '../components/CountrySelect';
import CustomerTypeSelect from '../components/CustomerTypeSelect';
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
      const res = await customerApi.options();
      setCustomerOptions(
        (res.data.data || []).map((c: Customer) => ({
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
    // 负责人默认当前创建人（页面已挂载即加载用户列表，此处直接回填即可生效）
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
        contactMethod: item.contactMethod || undefined,
        quantity: item.quantity ?? undefined,
        assignedTo: item.assignedTo,
        // 详情扩展字段
        targetMarket: item.targetMarket || undefined,
        productType: item.productType || undefined,
        productDesc: item.productDesc || undefined,
        targetPrice: item.targetPrice || undefined,
        certRequire: item.certRequire || undefined,
        packageReq: item.packageReq || undefined,
        deliveryReq: item.deliveryReq || undefined,
        specialReq: item.specialReq || undefined,
        customerType: item.customerType || undefined,
        urgency: item.urgency || undefined,
        images: Array.isArray(item.images)
          ? item.images
          : typeof item.images === 'string' && item.images
          ? JSON.parse(item.images)
          : [],
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
      // 名称由前端按「目标国家+产品名称+数量」规则生成后直接保存
      leadName: leadNamePreview || undefined,
      customerId,
      companyName,
      contactMethod: values.contactMethod || null,
      sourceChannel: values.sourceChannel || values.channel || null,
      productId,
      productName,
      quantity: values.quantity ? Number(values.quantity) || 0 : 0,
      // 负责人在弹窗标题栏（Form 外）选择，直接从表单实例读取最新值
      assignedTo: form.getFieldValue('assignedTo') || null,
      // 详情扩展字段
      targetMarket: values.targetMarket || null,
      productType: values.productType || null,
      productDesc: values.productDesc || null,
      targetPrice: values.targetPrice || null,
      certRequire: values.certRequire || null,
      packageReq: values.packageReq || null,
      deliveryReq: values.deliveryReq || null,
      specialReq: values.specialReq || null,
      customerType: values.customerType || null,
      urgency: values.urgency || null,
      images: Array.isArray(values.images) ? (values.images as string[]) : [],
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

  // 负责人：弹窗标题栏 Select 响应式绑定（该字段在 Form 外部，需 useWatch 驱动重渲染）
  const watchAssignedTo = Form.useWatch('assignedTo', form);
  // 线索名称自动生成：目标国家+产品名称+数量（修改字段时同步更新）
  const watchTargetMarket = Form.useWatch('targetMarket', form);
  const watchProductKey = Form.useWatch('productKey', form);
  const watchQuantity = Form.useWatch('quantity', form);
  const leadNamePreview = useMemo(() => {
    const parts: string[] = [];
    if (watchTargetMarket) parts.push(watchTargetMarket);
    if (watchProductKey) parts.push(watchProductKey);
    if (watchQuantity !== undefined && watchQuantity !== null) parts.push(String(watchQuantity));
    return parts.join('-');
  }, [watchTargetMarket, watchProductKey, watchQuantity]);

  // 客户/产品 AutoComplete 选项：以名称为值，支持手输或下拉选择
  // 客户下拉展示「公司名称 · 联系人」，搜索按整个文本模糊匹配
  const customerNameOptions = useMemo(
    () =>
      customerOptions.map((c) => ({
        value: c.label,
        label: [c.label, c.contactName].filter(Boolean).join(' · '),
      })),
    [customerOptions],
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
            boxShadow: `0 0 0 1px ${token.colorPrimary}`,
            transition: 'all .2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${token.colorPrimary}, 0 2px 12px ${token.colorPrimaryBg}`; }}
          onMouseLeave={(e) => { e.currentTarget.style.boxShadow = `0 0 0 1px ${token.colorPrimary}`; }}
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

      {/* 新建 / 编辑 / 详情弹窗（左右两栏） */}
      <AppModal
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? t('lead.editTitle') : t('lead.createTitle')}
        width={960}
        bodyPadding={20}
        extra={
          <Space size={8}>
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>{t('lead.assignee')}</span>
            <Select
              style={{ width: 180 }}
              showSearch
              allowClear
              placeholder={t('lead.assigneePlaceholder')}
              optionFilterProp="label"
              value={watchAssignedTo ?? undefined}
              onChange={(v) => form.setFieldsValue({ assignedTo: v })}
              options={userOptions.map((u) => ({ label: u.realName || u.username, value: u.id }))}
            />
          </Space>
        }
        footer={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={submit}>{t('common.save')}</Button>
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
          <Row gutter={24}>
            {/* 左栏：原字段 */}
            <Col span={12}>
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
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="customerKey"
                    label={
                      editing?.companyName && !editing.customerId ? (
                        <Space size={4}>
                          <span>{t('lead.customer')}</span>
                          <Tag
                            color="orange"
                            style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                            onClick={confirmCreateCustomer}
                            title={t('lead.customerPendingTip', { name: editing.companyName })}
                          >
                            {t('lead.pendingLabel')}
                          </Tag>
                        </Space>
                      ) : (
                        t('lead.customer')
                      )
                    }
                    rules={[{ required: true, message: t('lead.customerRequired') }]}
                  >
                    <AutoComplete
                      allowClear
                      placeholder={t('lead.customerPlaceholder')}
                      options={customerNameOptions}
                      filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(String(input ?? '').toLowerCase())}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="contactMethod" label={t('lead.contactMethod')}>
                    <Input placeholder={t('lead.contactMethodPlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="targetMarket" label={t('lead.targetMarket')}>
                    <CountrySelect placeholder={t('lead.targetMarketPlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="customerType" label={t('lead.customerType')}>
                    <CustomerTypeSelect placeholder={t('lead.customerTypePlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
            </Col>

            {/* 右栏：详情扩展字段 */}
            <Col span={12}>
              <Form.Item
                name="productKey"
                label={
                  editing?.productName && !editing.productId ? (
                    <Space size={4}>
                      <span>{t('lead.product')}</span>
                      <Tag
                        color="orange"
                        style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                        onClick={confirmCreateProduct}
                        title={t('lead.productPendingTip', { name: editing.productName })}
                      >
                        {t('lead.pendingLabel')}
                      </Tag>
                    </Space>
                  ) : (
                    t('lead.product')
                  )
                }
                rules={[{ required: true, message: t('lead.productRequired') }]}
              >
                <AutoComplete
                  allowClear
                  placeholder={t('lead.productPlaceholder')}
                  options={productNameOptions}
                  filterOption={(input, option) => String(option?.value ?? '').toLowerCase().includes(String(input ?? '').toLowerCase())}
                />
              </Form.Item>
              <Form.Item name="quantity" label={t('lead.quantityRequirement')} rules={[{ required: true, message: t('lead.quantityRequired') }]}>
                <Input placeholder={t('lead.quantityRequirementPlaceholder')} />
              </Form.Item>
              <Form.Item name="productDesc" label={t('lead.productDesc')}>
                <Input.TextArea rows={3} />
              </Form.Item>
              <Form.Item name="images" label={t('lead.images')}>
                <Upload
                  listType="picture-card"
                  fileList={(form.getFieldValue('images') as string[] | undefined)?.map((url, i) => ({ uid: `${i}`, name: `img${i}`, status: 'done', url })) || []}
                  onChange={({ fileList }) => {
                    const urls = fileList.filter((f) => f.status === 'done').map((f) => (f.url as string));
                    form.setFieldsValue({ images: urls });
                  }}
                  customRequest={({ file, onSuccess, onError }) => {
                    uploadImage(file as File)
                      .then((url) => onSuccess?.({ url }))
                      .catch(() => { message.error(t('common.uploadFailed')); onError?.(new Error('upload failed')); });
                  }}
                >
                  <div><PlusOutlined /><div style={{ marginTop: 8 }}>{t('common.upload')}</div></div>
                </Upload>
              </Form.Item>
              <Form.Item name="targetPrice" label={t('lead.targetPrice')}>
                <Input />
              </Form.Item>
              <Form.Item name="certRequire" label={t('lead.certRequire')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="packageReq" label={t('lead.packageReq')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="deliveryReq" label={t('lead.deliveryReq')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="specialReq" label={t('lead.specialReq')}>
                <Input.TextArea rows={2} />
              </Form.Item>
              <Form.Item name="urgency" label={t('lead.urgency')}>
                <Select
                  options={[
                    { value: 'LOW', label: t('lead.urgencyLow') },
                    { value: 'MEDIUM', label: t('lead.urgencyMedium') },
                    { value: 'HIGH', label: t('lead.urgencyHigh') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
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
