import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Alert,
  AutoComplete,
  Button,
  Form,
  Input,
  Row,
  Col,
  Select,
  Space,
  Tag,
  Modal,
  Popconfirm,
  theme,
} from 'antd';
import { CheckOutlined, SwapOutlined, RollbackOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AppModal from '../AppModal';
import CountrySelect from '../CountrySelect';
import CustomerTypeSelect from '../CustomerTypeSelect';
import CustomerFormModal from '../customer/modals/CustomerFormModal';
import { ProductEditModal, type ProductEditModalHandle } from '../product/modals/ProductEditModal';
import { type Channel } from '../../api/channel';
import { type Customer } from '../../api/customers';
import { leadApi, type Lead, type LeadPayload, type LeadStatus } from '../../api/lead';
import { salesApi, type SalesItem } from '../../api/sales';
import { type Product, type ProductAudience, type ProductCraft, type ProductOption } from '../../api/products';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUserStore } from '../../stores/useUserStore';
import { flattenChannelOptions } from './constants';
import { convertLeadToOpportunity } from '../../utils/convertLead';
import type { CustomerOption } from './useLeadOptions';
import ProductImageList from '../common/ProductImageList';
import { parseImages, serializeImages } from '../../utils/productImages';

export interface LeadFormModalHandle {
  openCreate: () => void;
  openEdit: (record: Lead) => void;
}

interface Props {
  channels: Channel[];
  productOptions: ProductOption[];
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  customerOptions: CustomerOption[];
  /** 新建客户 / 产品建档成功后刷新对应选项 */
  onRefreshCustomers: () => void;
  onRefreshProducts: () => void;
  /** 保存 / 关联成功后刷新列表 */
  onSaved: () => void;
}

/**
 * 线索新建 / 编辑 / 详情弹窗。
 * Form 包裹整个弹窗（含标题栏负责人字段），确认建档子弹窗（客户 / 产品）一并内聚于此。
 */
const LeadFormModal = forwardRef<LeadFormModalHandle, Props>((props, ref) => {
  const { t } = useTranslation();
  const { message, modal } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm();

  const {
    channels,
    productOptions,
    crafts,
    audiences,
    customerOptions,
    onRefreshCustomers,
    onRefreshProducts,
    onSaved,
  } = props;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [linkedPipeline, setLinkedPipeline] = useState<SalesItem | null>(null);
  const navigate = useNavigate();
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferUserId, setTransferUserId] = useState<string | undefined>();
  // 确认建档：新建客户弹窗（带入待确认客户名到公司名称）
  const [custModalOpen, setCustModalOpen] = useState(false);
  const [initialCustName, setInitialCustName] = useState('');
  const productEditRef = useRef<ProductEditModalHandle>(null);

  const currentUser = useAuthStore((s) => s.user);
  const userOptions = useUserStore((s) => s.users);
  const fetchUsers = useUserStore((s) => s.fetchUsers);

  // ============ 表单联动 ============
  const selectedChannel = Form.useWatch('channel', form);
  const watchTargetMarket = Form.useWatch('targetMarket', form);
  const watchProductKey = Form.useWatch('productKey', form);
  const watchQuantity = Form.useWatch('quantity', form);
  const watchCustomerKey = Form.useWatch('customerKey', form);

  const channelOptions = useMemo(() => flattenChannelOptions(channels), [channels]);

  // 平台选项：随渠道联动；无子平台时兜底为渠道本身
  const formPlatformOptions = useMemo(() => {
    if (!selectedChannel) return [];
    const node = channels.find((c) => c.name === selectedChannel);
    const children = node?.children || [];
    if (!children.length) return [{ label: selectedChannel, value: selectedChannel, title: selectedChannel }];
    return children.map((child) => ({
      label: child.name,
      value: `${selectedChannel} / ${child.name}`,
      title: `${selectedChannel} / ${child.name}`,
    }));
  }, [channels, selectedChannel]);

  // 线索名称：目标国家 + 产品名称 + 数量，自动生成
  const leadNamePreview = useMemo(() => {
    const parts: string[] = [];
    if (watchTargetMarket) parts.push(watchTargetMarket);
    if (watchProductKey) parts.push(watchProductKey);
    if (watchQuantity !== undefined && watchQuantity !== null) parts.push(String(watchQuantity));
    return parts.join('-');
  }, [watchTargetMarket, watchProductKey, watchQuantity]);

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

  // ============ 打开 / 提交 ============
  const openCreate = () => {
    setEditing(null);
    setLinkedPipeline(null);
    form.resetFields();
    onRefreshCustomers();
    fetchUsers();
    // 新建线索默认负责人为当前登录用户：同时写入表单字段（用于提交）与 editing（用于右上角回显）
    if (currentUser) {
      const defaultAssignee = {
        id: currentUser.id,
        realName: currentUser.realName,
        username: currentUser.username,
      };
      setEditing({ assignedTo: currentUser.id, assignedUser: defaultAssignee } as unknown as Lead);
      form.setFieldsValue({ assignedTo: currentUser.id });
    }
    setDrawerOpen(true);
  };

  const openEdit = async (record: Lead) => {
    setEditing(record);
    setLinkedPipeline(null);
    onRefreshCustomers();
    try {
      const res = await leadApi.get(record.id);
      const item = res.data;
      // 用详情接口的权威数据更新 editing（确保 status 等字段最新、完整）
      setEditing(item);
      // 来源渠道回填：若为「渠道 / 平台」路径则拆分，渠道自动带出
      const sourceParts = (item.sourceChannel || '').split(' / ');
      form.setFieldsValue({
        customerKey: item.customer?.companyName || item.companyName || undefined,
        channel: sourceParts.length > 1 ? sourceParts[0] : item.sourceChannel || '',
        sourceChannel: item.sourceChannel || undefined,
        productKey: item.product?.name || item.productName || undefined,
        contactMethod: item.contactMethod || undefined,
        quantity: item.quantity ?? undefined,
        // 负责人（标题栏 Form.Item 字段，一并回填）
        assignedTo: item.assignedTo ?? undefined,
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
        images: typeof item.images === 'string' ? item.images : Array.isArray(item.images) ? JSON.stringify(item.images) : '',
      });
      // 溯源：若已关联商机，加载商机信息用于展示
      if (item.pipelineId) {
        try {
          const pRes = await salesApi.get(item.pipelineId);
          setLinkedPipeline(pRes.data.data);
        } catch {
          setLinkedPipeline(null);
        }
      }
    } catch {
      /* 详情加载失败可忽略，表单保持空 */
    }
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
      // 负责人在弹窗标题栏（Form.Item 注册字段），随 validateFields 一并取回
      assignedTo: values.assignedTo || null,
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
      images: parseImages(values.images).map((i) => i.url),
    };
    try {
      if (editing?.id) {
        await leadApi.update(editing.id, payload);
        message.success(t('common.updateSuccess'));
      } else {
        await leadApi.create(payload);
        message.success(t('common.createSuccess'));
      }
      setDrawerOpen(false);
      onSaved();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // ============ 状态切换 ============
  // NEW=新建 / VALID=有效 可编辑；INVALID=无效 不可编辑，但可切回有效
  const changeLeadStatusTo = async (status: LeadStatus) => {
    if (!editing) return;
    try {
      await leadApi.changeStatus(editing.id, status);
      message.success(t('lead.statusUpdated'));
      // 同步本地编辑状态，使表单禁用/启用即时生效（仅切换状态，不关闭弹窗）
      setEditing((prev) => (prev ? { ...prev, status } : prev));
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 确认线索：检测客户/产品建档 → 未建档则新建 → 新建商机 → 标记「已确认」
  const handleConfirmLead = () => {
    if (!editing) return;
    modal.confirm({
      title: t('lead.confirmConvertTitle'),
      content: t('lead.confirmConvertContent'),
      okText: t('common.ok'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        const res = await convertLeadToOpportunity(editing.id);
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
                    onClose();
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
        onSaved?.();
      },
    });
  };

  // 释放线索（私海 → 公海）
  const handleReleaseLead = async () => {
    if (!editing) return;
    try {
      await leadApi.release(editing.id);
      message.success(t('lead.releaseSuccess'));
      onSaved?.();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 转交线索（联动客户/产品负责人）
  const handleTransferLead = async () => {
    if (!editing || !transferUserId) return;
    try {
      await leadApi.transfer(editing.id, transferUserId);
      message.success(t('lead.transferSuccess'));
      setTransferOpen(false);
      setTransferUserId(undefined);
      onSaved?.();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // 标记无效
  const handleInvalidLead = () => changeLeadStatusTo('INVALID');

  // 切回有效（从无效恢复）
  const handleSetValid = () => changeLeadStatusTo('VALID');

  // ============ 确认建档 ============
  // 走「新建客户 / 新建产品」弹窗，带入待确认的名称，由用户在弹窗中补全并确认后创建
  const confirmCreateCustomer = () => {
    if (readonly) return;
    if (!editing?.companyName) return;
    setInitialCustName(editing.companyName);
    setCustModalOpen(true);
  };

  const confirmCreateProduct = () => {
    if (readonly) return;
    if (!editing?.productName) return;
    productEditRef.current?.open(null, { name: editing.productName ?? '' });
  };

  // 新建客户弹窗保存成功后：关联到当前线索
  const handleCustomerFiled = async (customer?: Customer) => {
    if (!customer?.id || !editing) return;
    try {
      await leadApi.update(editing.id, { customerId: customer.id, companyName: null });
      message.success(t('common.createSuccess'));
      onRefreshCustomers();
      onSaved();
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
      onRefreshProducts();
      onSaved();
      setEditing({ ...editing, productId: saved.id, productName: null });
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  // 新建模式（无真实线索 id）下，转交/释放/无效/确认等仅对已有线索的操作不可用
  const isCreate = !editing?.id;
  // 已确认（QUALIFIED）与无效（INVALID）一样为只读：禁用所有编辑/操作
  const readonly = editing?.status === 'INVALID' || editing?.status === 'QUALIFIED';

  useImperativeHandle(ref, () => ({ openCreate, openEdit }));

  return (
    <>
      {/* 新建 / 编辑 / 详情弹窗（左右两栏）：Form 包裹整个弹窗，标题栏负责人字段一并纳入表单管理 */}
      <Form form={form} layout="vertical" preserve={false} autoComplete="off" disabled={readonly}>
        <AppModal
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={
            <Space size={8}>
              <span>{editing?.id ? editing.leadName || t('lead.editTitle') : leadNamePreview || t('lead.createTitle')}</span>
              {editing?.id && editing.leadNumber && (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  {editing.leadNumber}
                </Tag>
              )}
            </Space>
          }
          closable={false}
          headerBorder={false}
          width={960}
          bodyPadding={20}
          style={{ borderRadius: 20 }}
          extra={
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              {/* 负责人信息 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #fa8c16 0%, #f5a623 100%)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {editing?.assignedUser?.realName?.[0] ||
                    editing?.assignedUser?.username?.[0] ||
                    '?'}
                </div>
                <div style={{ lineHeight: 1.3 }}>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{t('sales.assignedTo')}</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(0,0,0,0.88)' }}>
                    {editing?.assignedUser?.realName || t('sales.unassigned')}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                    {editing?.assignedUser?.username || ''}
                  </div>
                </div>
              </div>
              {/* 转交 / 释放（仅已有线索详情展示，新建时隐藏） */}
              {!isCreate && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {/* 转交：未分配也允许（便于指派负责人）；只读态禁用 */}
                  <Button
                    shape="circle"
                    size="middle"
                    icon={<SwapOutlined style={{ color: token.colorWarning }} />}
                    style={{ background: token.colorWarningBg, borderColor: token.colorWarningBg }}
                    disabled={readonly}
                    onClick={() => setTransferOpen(true)}
                    title={t('lead.transfer')}
                  />
                  {/* 释放：仅已分配负责人时显示；只读态禁用 */}
                  {editing?.assignedTo && (
                    <Popconfirm
                      title={t('lead.confirmRelease')}
                      okText={t('common.ok')}
                      cancelText={t('common.cancel')}
                      disabled={readonly}
                      onConfirm={handleReleaseLead}
                    >
                      <Button
                        shape="circle"
                        size="middle"
                        icon={<RollbackOutlined style={{ color: token.colorWarning }} />}
                        style={{ background: token.colorWarningBg, borderColor: token.colorWarningBg }}
                        disabled={readonly}
                        title={t('lead.release')}
                      />
                    </Popconfirm>
                  )}
                </div>
              )}
              {/* 关闭按钮（与客户详情样式一致） */}
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                title="关闭"
                style={{
                  width: 36,
                  height: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  backgroundColor: token.colorFillQuaternary,
                  fontSize: 15,
                  lineHeight: 1,
                  transition: 'all 0.22s ease',
                  padding: 0,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = token.colorFillSecondary;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = token.colorFillQuaternary;
                }}
                onFocus={(e) => {
                  e.currentTarget.style.boxShadow = `0 0 0 3px ${token.colorFillSecondary}`;
                }}
                onBlur={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                <CloseOutlined style={{ color: token.colorTextSecondary }} />
              </button>
            </div>
          }
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <Space>
                {editing?.id && !readonly && (
                  <Button danger onClick={handleInvalidLead}>
                    {t('lead.invalid')}
                  </Button>
                )}
                {editing?.id && editing.status === 'INVALID' && (
                  <Button type="primary" disabled={false} onClick={handleSetValid}>
                    {t('lead.valid')}
                  </Button>
                )}
              </Space>
              <Space>
                <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
                {editing?.id && !readonly && editing.status !== 'QUALIFIED' && (
                  <Button type="primary" onClick={handleConfirmLead}>
                    {t('lead.confirmLead')}
                  </Button>
                )}
                {(!editing?.id || !readonly) && (
                  <Button type="primary" icon={<CheckOutlined />} onClick={submit}>{t('common.save')}</Button>
                )}
              </Space>
            </div>
          }
        >
          {/* 负责人以只读文本显示于右上角，此处保留隐藏字段以便提交时携带 assignedTo */}
          <Form.Item name="assignedTo" hidden>
            <Input />
          </Form.Item>
          {/* 溯源：已关联商机 */}
          {(editing?.pipelineId || linkedPipeline) && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              title={
                <Space>
                  <span>
                    {t('lead.linkedPipeline')}：<b>{linkedPipeline?.pipelineNumber || editing?.pipelineId}</b>
                  </span>
                  <Button
                    type="link"
                    size="small"
                    disabled={!editing?.pipelineId && !linkedPipeline?.id}
                    onClick={() => {
                      const id = editing?.pipelineId || linkedPipeline?.id;
                      if (id) navigate(`/sales/opportunities?pipelineId=${id}`);
                      else navigate('/sales/opportunities');
                    }}
                  >
                    {t('lead.viewPipeline')}
                  </Button>
                </Space>
              }
            />
          )}
          {/* 统一网格布局：每行平分四份（span=6），行间距加大更透气；stretch 让同排 Col 等高 */}
          <Row gutter={[16, 24]} className="lead-form-grid">
            {/* 第一行：来源渠道 / 来源平台 / 目标市场 / 客户类型 */}
            <Col span={6}>
              <Form.Item name="channel" label={t('lead.channel')} rules={[{ required: true, message: t('lead.channelRequired') }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder={t('lead.channelPlaceholder')}
                  optionFilterProp="label"
                  options={channelOptions}
                  onChange={() => form.setFieldsValue({ sourceChannel: undefined })}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="sourceChannel" label={t('lead.platform')} rules={[{ required: true, message: t('lead.platformRequired') }]}>
                <Select
                  showSearch
                  allowClear
                  placeholder={t('lead.platformPlaceholder')}
                  optionFilterProp="label"
                  options={formPlatformOptions}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="targetMarket" label={t('lead.targetMarket')}>
                <CountrySelect placeholder={t('lead.targetMarketPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="customerType" label={t('lead.customerType')}>
                <CustomerTypeSelect placeholder={t('lead.customerTypePlaceholder')} />
              </Form.Item>
            </Col>

            {/* 参考图片纵向跨三行（左侧）；右侧三行：客户/沟通账号、采购产品/数量要求、目标价位/产品描述（最底行） */}
            <Col span={12}>
              <Form.Item name="images" label={t('lead.images')}>
                <ProductImageList disabled={readonly} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Row gutter={[16, 24]}>
                <Col span={12}>
                  <Form.Item
                    name="customerKey"
                    label={
                      (editing?.companyName && !editing.customerId) ||
                      (watchCustomerKey && !customerOptions.some((c) => c.label === watchCustomerKey)) ? (
                        <Space size={4}>
                          <span>{t('lead.customer')}</span>
                          <Tag
                            color="orange"
                            style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                            onClick={confirmCreateCustomer}
                            title={t('lead.customerPendingTip', { name: editing?.companyName || watchCustomerKey })}
                          >
                            {t('lead.pendingTag')}
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
                    <Input autoComplete="off" placeholder={t('lead.contactMethodPlaceholder')} />
                  </Form.Item>
                </Col>
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
                            {t('lead.pendingTag')}
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
                </Col>
                <Col span={12}>
                  <Form.Item name="quantity" label={t('lead.quantityRequirement')} rules={[{ required: true, message: t('lead.quantityRequired') }]}>
                    <Input autoComplete="off" placeholder={t('lead.quantityRequirementPlaceholder')} />
                  </Form.Item>
                </Col>
                {/* 参考图片右侧最底行：目标价位 / 产品描述 */}
                <Col span={12}>
                  <Form.Item name="targetPrice" label={t('lead.targetPrice')}>
                    <Input autoComplete="off" placeholder={t('lead.targetPricePlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="productDesc" label={t('lead.productDesc')}>
                    <Input.TextArea rows={6} autoComplete="off" placeholder={t('lead.productDescPlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
            </Col>

            {/* 第五行：要求（特殊要求 / 认证要求 / 包装要求 / 交期要求） */}
            <Col span={12}>
              <Form.Item name="specialReq" label={t('lead.specialReq')}>
                <Input.TextArea rows={2} autoComplete="off" placeholder={t('lead.specialReqPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="certRequire" label={t('lead.certRequire')}>
                <Input.TextArea rows={2} autoComplete="off" placeholder={t('lead.certRequirePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="packageReq" label={t('lead.packageReq')}>
                <Input.TextArea rows={2} autoComplete="off" placeholder={t('lead.packageReqPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="deliveryReq" label={t('lead.deliveryReq')}>
                <Input.TextArea rows={2} autoComplete="off" placeholder={t('lead.deliveryReqPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
        </AppModal>
      </Form>

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

      {/* 转交线索：选择新负责人（联动客户/产品负责人） */}
      <Modal
        title={t('lead.transfer')}
        open={transferOpen}
        onOk={handleTransferLead}
        onCancel={() => {
          setTransferOpen(false);
          setTransferUserId(undefined);
        }}
        okText={t('common.ok')}
        cancelText={t('common.cancel')}
        okButtonProps={{ disabled: !transferUserId }}
      >
        <Select
          style={{ width: '100%' }}
          showSearch
          value={transferUserId}
          onChange={setTransferUserId}
          placeholder={t('lead.selectTransferTarget')}
          optionFilterProp="label"
          options={userOptions.map((u) => ({ label: u.realName || u.username, value: u.id }))}
        />
      </Modal>
    </>
  );
});

export default LeadFormModal;
