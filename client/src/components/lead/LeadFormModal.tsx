import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  Row,
  Col,
  Select,
  Space,
  Tag,
} from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AppModal from '../AppModal';
import CountrySelect from '../CountrySelect';
import CustomerTypeSelect from '../CustomerTypeSelect';
import CustomerFormModal from '../customer/modals/CustomerFormModal';
import { ProductEditModal, type ProductEditModalHandle } from '../product/modals/ProductEditModal';
import { type Channel } from '../../api/channel';
import { type Customer } from '../../api/customers';
import { leadApi, type Lead, type LeadPayload } from '../../api/lead';
import { type Product, type ProductAudience, type ProductCraft, type ProductOption } from '../../api/products';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUserStore } from '../../stores/useUserStore';
import { flattenChannelOptions } from './constants';
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
  const { message } = App.useApp();
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
    form.resetFields();
    onRefreshCustomers();
    fetchUsers();
    // 负责人已注册为表单字段（标题栏 Form.Item），同步写入即可，打开后自动回显当前创建人
    form.setFieldsValue({ assignedTo: currentUser?.id ?? undefined });
    setDrawerOpen(true);
  };

  const openEdit = async (record: Lead) => {
    setEditing(record);
    onRefreshCustomers();
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
        urgency: item.urgency || undefined,
        images: serializeImages(
          parseImages(
            typeof item.images === 'string'
              ? item.images
              : Array.isArray(item.images)
              ? JSON.stringify(item.images)
              : undefined,
          ),
        ),
      });
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
      urgency: values.urgency || null,
      images: parseImages(values.images),
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
      onSaved();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  // ============ 确认建档 ============
  // 走「新建客户 / 新建产品」弹窗，带入待确认的名称，由用户在弹窗中补全并确认后创建
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

  useImperativeHandle(ref, () => ({ openCreate, openEdit }));

  return (
    <>
      {/* 新建 / 编辑 / 详情弹窗（左右两栏）：Form 包裹整个弹窗，标题栏负责人字段一并纳入表单管理 */}
      <Form form={form} layout="vertical" preserve={false} autoComplete="off">
        <AppModal
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          title={editing ? t('lead.editTitle') : t('lead.createTitle')}
          width={960}
          bodyPadding={20}
          extra={
            <Space size={8}>
              <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 14, lineHeight: '32px' }}>{t('lead.assignee')}</span>
              <Form.Item name="assignedTo" noStyle>
                <Select
                  style={{ width: 180 }}
                  showSearch
                  allowClear
                  placeholder={t('lead.assigneePlaceholder')}
                  optionFilterProp="label"
                  options={userOptions.map((u) => ({ label: u.realName || u.username, value: u.id }))}
                />
              </Form.Item>
            </Space>
          }
          footer={
            <Space>
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
              <Button type="primary" icon={<CheckOutlined />} onClick={submit}>{t('common.save')}</Button>
            </Space>
          }
        >
          {/* 统一网格布局：每行平分四份（span=6），行间距加大更透气；stretch 让同排 Col 等高 */}
          <Row gutter={[16, 24]} className="lead-form-grid">
            {/* 第一行：线索名称(占2份) / 紧急程度 / 采购产品 */}
            <Col span={12}>
              <Form.Item label={t('lead.name')} required>
                <Input
                  autoComplete="off"
                  value={leadNamePreview}
                  readOnly
                  placeholder={t('lead.nameAutoPlaceholder')}
                  style={{ color: 'rgba(0, 0, 0, 0.65)', background: '#f5f5f5', cursor: 'not-allowed' }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="urgency" label={t('lead.urgency')}>
                <Select
                  placeholder={t('lead.urgencyPlaceholder')}
                  options={[
                    { value: 'LOW', label: t('lead.urgencyLow') },
                    { value: 'MEDIUM', label: t('lead.urgencyMedium') },
                    { value: 'HIGH', label: t('lead.urgencyHigh') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
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

            {/* 第二行：来源渠道 / 来源平台 / 数量需求 / 目标价位 */}
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
                  disabled={!selectedChannel}
                  placeholder={t('lead.platformPlaceholder')}
                  optionFilterProp="label"
                  options={formPlatformOptions}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="quantity" label={t('lead.quantityRequirement')} rules={[{ required: true, message: t('lead.quantityRequired') }]}>
                <Input autoComplete="off" placeholder={t('lead.quantityRequirementPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="targetPrice" label={t('lead.targetPrice')}>
                <Input autoComplete="off" placeholder={t('lead.targetPricePlaceholder')} />
              </Form.Item>
            </Col>

            {/* 第三行 + 第四行：左侧 2x2（客户/沟通方式/目标市场/客户类型），右侧产品描述(占2份、跨2行) */}
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
            <Col span={12}>
              <Form.Item name="productDesc" label={t('lead.productDesc')}>
                <Input.TextArea rows={6} autoComplete="off" placeholder={t('lead.productDescPlaceholder')} />
              </Form.Item>
            </Col>

            {/* 第五行 + 第六行：左侧参考图片(占2份、跨2行)，右侧 2x2（认证要求/包装要求/交期要求/特殊要求） */}
            <Col span={12}>
              <Form.Item name="images" label={t('lead.images')}>
                <ProductImageList />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Row gutter={[16, 24]}>
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
                <Col span={12}>
                  <Form.Item name="specialReq" label={t('lead.specialReq')}>
                    <Input.TextArea rows={2} autoComplete="off" placeholder={t('lead.specialReqPlaceholder')} />
                  </Form.Item>
                </Col>
              </Row>
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
    </>
  );
});

export default LeadFormModal;
