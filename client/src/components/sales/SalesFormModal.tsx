import React, { useEffect, useState } from 'react';
import { Form, Input, Select, InputNumber, DatePicker, Row, Col, Divider, Typography, Button, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import AppModal from '../AppModal';
import { salesApi } from '../../api/sales';
import { customerApi } from '../../api/customers';
import { productApi, ProductOption } from '../../api/products';

const { TextArea } = Input;
const { Text } = Typography;

// 采购意向（probability）中文标签
const INTENT_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  WIN: '赢单',
};
export function getIntentLabel(value?: string | null): string {
  if (!value) return '';
  return INTENT_LABELS[value] ?? value;
}

export interface SalesFormValues {
  customerId?: string;
  // 阶段由后端按关联单据派生，表单不再提交 stage
  title: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  country?: string;
  source?: string;
  productInterest?: string;
  leadNotes?: string;
  estimatedAmount?: number;
  estimatedCloseDate?: string;
  probability?: string;
  opportunityNotes?: string;
  sampleType?: string;
  sampleQuantity?: number;
  sampleStatus?: string;
  sampleNotes?: string;
  orderAmount?: number;
  orderDate?: string;
  deliveryDate?: string;
  paymentTerms?: string;
  orderStatus?: string;
  orderType?: 'SAMPLE' | 'FORMAL';
  orderNotes?: string;
  assignedTo?: string;
  leadId?: string;
  products?: { productId: string; quantity?: number }[];
}

interface Props {
  open: boolean;
  editingItem?: any;
  /** 详情场景：传入客户信息后仅展示、不可编辑 */
  customer?: any;
  /** 详情场景：锁定负责人（不可改） */
  fixedOwner?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

const SalesFormModal: React.FC<Props> = ({ open, editingItem, customer, fixedOwner, onClose, onSaved }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [assignUsers, setAssignUsers] = useState<{ id: string; realName: string; username: string }[]>([]);
  const [leadProducts, setLeadProducts] = useState<{ productId: string; quantity?: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const isEdit = !!editingItem;
  const isDetail = !!(customer || fixedOwner);

  // 打开时加载下拉数据 + 回填
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const [c, p, u] = await Promise.all([
          customerApi.options(),
          productApi.options(),
          salesApi.getAssignUsers(),
        ]);
        setCustomers(c.data.data ?? []);
        setProducts(p.data.data ?? []);
        setAssignUsers(u.data.data ?? []);
      } catch {
        /* ignore */
      }
    };
    load();

    if (editingItem) {
      setLoading(true);
      const item = editingItem;
      form.setFieldsValue({
        ...item,
        estimatedCloseDate: item.estimatedCloseDate ? dayjs(item.estimatedCloseDate) : undefined,
        orderDate: item.orderDate ? dayjs(item.orderDate) : undefined,
        deliveryDate: item.deliveryDate ? dayjs(item.deliveryDate) : undefined,
      });
      setLeadProducts(Array.isArray(item.leadProducts) ? item.leadProducts.map((lp: any) => ({ productId: lp.productId, quantity: lp.quantity })) : []);
      setLoading(false);
    } else {
      form.resetFields();
      form.setFieldsValue({
        source: 'LEAD_CONVERT',
        assignedTo: customer?.ownerId || undefined,
        leadId: customer?.id,
        customerId: customer?.id,
      });
      setLeadProducts([]);
    }
  }, [open, editingItem, customer, fixedOwner, form]);

  // 详情场景：受控回填（不依赖 rAF）
  useEffect(() => {
    if (open && isDetail && customer) {
      form.setFieldsValue({
        customerId: customer.id,
        assignedTo: customer.ownerId || undefined,
        leadId: customer.id,
        title: customer.opportunityTitle || '',
        companyName: customer.companyName || '',
        contactName: customer.contactName || '',
        email: customer.email || '',
        phone: customer.phone || '',
        country: customer.country || '',
      });
    }
  }, [open, isDetail, customer, form]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload: any = {
        ...values,
        estimatedCloseDate: values.estimatedCloseDate ? values.estimatedCloseDate.format('YYYY-MM-DD') : undefined,
        orderDate: values.orderDate ? values.orderDate.format('YYYY-MM-DD') : undefined,
        deliveryDate: values.deliveryDate ? values.deliveryDate.format('YYYY-MM-DD') : undefined,
        products: leadProducts.length ? leadProducts : undefined,
      };
      if (isEdit) {
        await salesApi.update(editingItem.id, payload);
      } else {
        await salesApi.create(payload);
      }
      onSaved();
    } catch (e: any) {
      if (e?.message) {
        // validateFields 抛错时不提示
      }
    } finally {
      setSaving(false);
    }
  };

  const sourceOptions = [
    { value: 'ALIBABA', label: t('sales.source.alibaba') },
    { value: 'MADE_IN_CHINA', label: t('sales.source.madeInChina') },
    { value: 'INDEPENDENT_SITE', label: t('sales.source.independentSite') },
    { value: 'FACEBOOK', label: t('sales.source.facebook') },
    { value: 'INSTAGRAM', label: t('sales.source.instagram') },
    { value: 'LINKEDIN', label: t('sales.source.linkedin') },
    { value: 'GOOGLE', label: t('sales.source.google') },
    { value: 'EXHIBITION', label: t('sales.source.exhibition') },
    { value: 'OLD_CUSTOMER', label: t('sales.source.oldCustomer') },
    { value: 'REFERRAL', label: t('sales.source.referral') },
    { value: 'OTHER', label: t('sales.source.other') },
    { value: 'LEAD_CONVERT', label: t('sales.source.leadConvert') },
  ];

  return (
    <AppModal
      open={open}
      title={isEdit ? t('sales.editTitle') : t('sales.newTitle')}
      onClose={onClose}
      width={720}
      footer={
        isDetail ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="primary" loading={saving} onClick={handleSubmit}>
              {t('common.save')}
            </Button>
          </>
        )
      }
      bodyPadding={24}
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical" disabled={isDetail}>
          <Divider titlePlacement="left">{t('sales.section.basic')}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="customerId" label={t('sales.customer')}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('sales.selectCustomer')}
                  options={customers.map((c) => ({ value: c.id, label: c.companyName }))}
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="assignedTo" label={t('sales.owner')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectOwner')}
                  options={assignUsers.map((u) => ({ value: u.id, label: u.realName || u.username }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="title" label={t('sales.title')} rules={[{ required: true, message: t('sales.titleRequired') }]}>
                <Input placeholder={t('sales.titlePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="companyName" label={t('sales.companyName')} rules={[{ required: true, message: t('sales.companyRequired') }]}>
                <Input placeholder={t('sales.companyPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="contactName" label={t('sales.contact')}>
                <Input placeholder={t('sales.contactPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="email" label={t('sales.email')}>
                <Input placeholder={t('sales.emailPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label={t('sales.phone')}>
                <Input placeholder={t('sales.phonePlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="country" label={t('sales.country')}>
                <Input placeholder={t('sales.countryPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="source" label={t('sales.source.label')}>
                <Select options={sourceOptions} allowClear placeholder={t('sales.selectSource')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="productInterest" label={t('sales.productInterest')}>
            <Input placeholder={t('sales.productInterestPlaceholder')} />
          </Form.Item>

          <Divider titlePlacement="left">{t('sales.section.lead')}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="estimatedAmount" label={t('sales.estAmount')}>
                <InputNumber min={0} style={{ width: '100%' }} placeholder={t('sales.amountPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="estimatedCloseDate" label={t('sales.estCloseDate')}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="probability" label={t('sales.probability')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectProbability')}
                  options={[
                    { value: 'LOW', label: t('sales.prob.low') },
                    { value: 'MEDIUM', label: t('sales.prob.medium') },
                    { value: 'HIGH', label: t('sales.prob.high') },
                    { value: 'WIN', label: t('sales.prob.win') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="leadNotes" label={t('sales.leadNotes')}>
            <TextArea rows={2} placeholder={t('sales.leadNotesPlaceholder')} />
          </Form.Item>
          <Form.Item name="opportunityNotes" label={t('sales.opportunityNotes')}>
            <TextArea rows={2} placeholder={t('sales.opportunityNotesPlaceholder')} />
          </Form.Item>

          <Divider titlePlacement="left">{t('sales.section.products')}</Divider>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('sales.productsHint')}
          </Text>
          <div style={{ marginTop: 8 }}>
            {products.length === 0 ? (
              <Text type="secondary">{t('sales.noProducts')}</Text>
            ) : (
              leadProducts.map((lp, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder={t('sales.selectProduct')}
                    value={lp.productId || undefined}
                    onChange={(v) => {
                      const next = [...leadProducts];
                      next[idx] = { ...next[idx], productId: v };
                      setLeadProducts(next);
                    }}
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <InputNumber
                    min={1}
                    placeholder={t('sales.qty')}
                    value={lp.quantity}
                    onChange={(v) => {
                      const next = [...leadProducts];
                      next[idx] = { ...next[idx], quantity: v || undefined };
                      setLeadProducts(next);
                    }}
                  />
                  {!isDetail && (
                    <Button
                      danger
                      type="text"
                      onClick={() => setLeadProducts(leadProducts.filter((_, i) => i !== idx))}
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </div>
              ))
            )}
            {!isDetail && (
              <Button
                type="dashed"
                block
                onClick={() => setLeadProducts([...leadProducts, { productId: '', quantity: 1 }])}
              >
                + {t('sales.addProduct')}
              </Button>
            )}
          </div>

          <Divider titlePlacement="left">{t('sales.section.sample')}</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sampleType" label={t('sales.sampleType')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectSampleType')}
                  options={[
                    { value: 'FREE', label: t('sales.sample.free') },
                    { value: 'CHARGE', label: t('sales.sample.charge') },
                    { value: 'REFUNDABLE', label: t('sales.sample.refundable') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleQuantity" label={t('sales.sampleQuantity')}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleStatus" label={t('sales.sampleStatus')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectSampleStatus')}
                  options={[
                    { value: 'PENDING', label: t('sales.sample.pending') },
                    { value: 'MAKING', label: t('sales.sample.making') },
                    { value: 'SENT', label: t('sales.sample.sent') },
                    { value: 'CONFIRMED', label: t('sales.sample.confirmed') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="sampleNotes" label={t('sales.sampleNotes')}>
            <TextArea rows={2} />
          </Form.Item>

          <Divider titlePlacement="left">{t('sales.section.order')}</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="orderType" label={t('sales.orderType')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectOrderType')}
                  options={[
                    { value: 'SAMPLE', label: t('sales.order.sample') },
                    { value: 'FORMAL', label: t('sales.order.formal') },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="orderAmount" label={t('sales.orderAmount')}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="orderStatus" label={t('sales.orderStatus')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectOrderStatus')}
                  options={[
                    { value: 'PENDING', label: t('sales.order.pending') },
                    { value: 'PRODUCING', label: t('sales.order.producing') },
                    { value: 'SHIPPED', label: t('sales.order.shipped') },
                    { value: 'DONE', label: t('sales.order.done') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="orderDate" label={t('sales.orderDate')}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deliveryDate" label={t('sales.deliveryDate')}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="paymentTerms" label={t('sales.paymentTerms')}>
                <Input placeholder={t('sales.paymentPlaceholder')} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="orderNotes" label={t('sales.orderNotes')}>
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Spin>
    </AppModal>
  );
};

export default SalesFormModal;
