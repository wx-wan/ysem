import React, { useEffect, useState } from 'react';
import { App, Form, Input, Select, InputNumber, DatePicker, Row, Col, Divider, Typography, Button, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import AppModal from '../AppModal';
import { salesApi, type IntentLevel, type OpportunityUpdatePayload, type SalesItem } from '../../api/sales';
import { customerApi } from '../../api/customers';
import { leadApi } from '../../api/lead';
import { productApi, ProductOption } from '../../api/products';

const { TextArea } = Input;
const { Text } = Typography;

// 采购意向（intentLevel）中文标签；`WIN` 仅为兼容旧版 probability 文案展示
const INTENT_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  READY: '准成交',
  WIN: '赢单',
};
export function getIntentLabel(value?: string | null): string {
  if (!value) return '';
  return INTENT_LABELS[value] ?? value;
}

/** 与后端 opportunityUpdateSchema 对齐的可写字段（来源线索 / 渠道 / 阶段均为起始事实，不提交） */
export interface SalesFormValues {
  customerId: string;
  leadId: string;
  title: string;
  ownerId?: string | null;
  estimatedAmount?: number | null;
  estimatedCloseDate?: dayjs.Dayjs | null;
  intentLevel?: IntentLevel | null;
  notes?: string | null;
}

interface Props {
  open: boolean;
  /** 商机不支持新建：本弹窗只做编辑，`editingItem` 必传 */
  editingItem: SalesItem;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 商机表单弹窗 —— **仅编辑**。
 *
 * 规则（冻结）：商机不支持创建、不支持导入，唯一来源是「线索确认」
 * （见 `utils/convertLead.ts`，走 `leadApi.confirm` ← `POST /api/leads/:id/confirm`）。
 * 故本弹窗不提供 create 分支；来源线索为起始事实，编辑时只读。
 */
const SalesFormModal: React.FC<Props> = ({ open, editingItem, onClose, onSaved }) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [form] = Form.useForm<SalesFormValues>();
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [assignUsers, setAssignUsers] = useState<{ id: string; realName: string; username: string }[]>([]);
  const [leads, setLeads] = useState<{ value: string; label: string }[]>([]);
  const [itemRows, setItemRows] = useState<{ productId: string; quantity?: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // 打开时加载下拉数据 + 回填
  useEffect(() => {
    if (!open) return;
    const load = async () => {
      try {
        const [c, p, u, l] = await Promise.all([
          customerApi.options(),
          productApi.options(),
          salesApi.getAssignUsers(),
          leadApi.list({ page: 1, pageSize: 100 }),
        ]);
        setCustomers(c.data.data ?? []);
        setProducts(p.data.data ?? []);
        setAssignUsers(u.data.data ?? []);
        setLeads(
          (l.data?.list ?? []).map((lead) => ({
            value: lead.id,
            label: `${lead.leadNo || lead.id.slice(0, 8)} ${lead.leadName || ''}`.trim(),
          })),
        );
      } catch {
        /* ignore */
      }
    };
    load();

    // 商机只做编辑：恒以 editingItem 回填
    setLoading(true);
    const item = editingItem;
    form.setFieldsValue({
      customerId: item.customerId,
      leadId: item.leadId ?? undefined,
      title: item.title,
      ownerId: item.ownerId ?? undefined,
      estimatedAmount: item.estimatedAmount == null ? undefined : Number(item.estimatedAmount),
      estimatedCloseDate: item.estimatedCloseDate ? dayjs(item.estimatedCloseDate) : undefined,
      intentLevel: item.intentLevel ?? undefined,
      notes: item.notes ?? undefined,
    });
    // 后端契约：items 为商机关联产品明细（提供即整体替换）
    setItemRows(
      (item.items ?? []).map((it) => ({ productId: it.productId ?? '', quantity: it.quantity ?? 1 })),
    );
    setLoading(false);
  }, [open, editingItem, form]);

  const handleSubmit = async () => {
    let values: SalesFormValues;
    try {
      values = await form.validateFields();
    } catch {
      // 校验失败：antd 已在表单内提示，无需额外 toast
      return;
    }
    setSaving(true);
    try {
      const validProducts = itemRows.filter((p) => p.productId);
      // 来源线索为 Sales Process 起始事实，不可修改（后端会 400），编辑时不提交
      const payload: OpportunityUpdatePayload = {
        customerId: values.customerId,
        title: values.title,
        ownerId: values.ownerId ?? null,
        estimatedAmount: values.estimatedAmount ?? null,
        estimatedCloseDate: values.estimatedCloseDate ? values.estimatedCloseDate.format('YYYY-MM-DD') : null,
        intentLevel: values.intentLevel ?? null,
        notes: values.notes ?? null,
        // 总是提交 products（空数组 = 清空关联产品，后端按「提供即替换」处理）
        products: validProducts,
      };
      await salesApi.update(editingItem.id, payload);
      onSaved();
    } catch (e: any) {
      // 展示后端校验/权限文案（如「线索不能为空」），兜底为通用失败提示
      message.error(e?.response?.data?.message || t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppModal
      open={open}
      title={t('sales.editTitle')}
      onClose={onClose}
      width={720}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={handleSubmit}>
            {t('common.save')}
          </Button>
        </>
      }
      bodyPadding={24}
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          <Divider titlePlacement="left">{t('sales.section.basic')}</Divider>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="customerId"
                label={t('sales.customer')}
                rules={[{ required: true, message: t('sales.customerRequired') }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('sales.selectCustomer')}
                  options={customers.map((c) => ({ value: c.id, label: c.companyName }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="leadId"
                label={t('sales.sourceLead')}
                rules={[{ required: true, message: t('sales.leadRequired') }]}
              >
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder={t('sales.selectLead')}
                  options={leads}
                  disabled
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                name="title"
                label={t('sales.title_field')}
                rules={[{ required: true, message: t('sales.titleRequired') }]}
              >
                <Input placeholder={t('sales.titlePlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="ownerId" label={t('sales.owner')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectOwner')}
                  options={assignUsers.map((u) => ({ value: u.id, label: u.realName || u.username }))}
                />
              </Form.Item>
            </Col>
          </Row>

          <Divider titlePlacement="left">{t('sales.section.lead')}</Divider>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="estimatedAmount" label={t('sales.estAmount')}>
                <InputNumber min={0} style={{ width: '100%' }} placeholder={t('sales.amountPlaceholder')} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="estimatedCloseDate" label={t('sales.estCloseDate')}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="intentLevel" label={t('sales.probability')}>
                <Select
                  allowClear
                  placeholder={t('sales.selectProbability')}
                  options={[
                    { value: 'LOW', label: t('sales.prob.low') },
                    { value: 'MEDIUM', label: t('sales.prob.medium') },
                    { value: 'HIGH', label: t('sales.prob.high') },
                    { value: 'READY', label: t('sales.prob.ready') },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label={t('sales.opportunityNotes')}>
            <TextArea rows={2} placeholder={t('sales.opportunityNotesPlaceholder')} />
          </Form.Item>

          <Divider titlePlacement="left">{t('sales.section.products')}</Divider>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('sales.productsHint')}
          </Text>
          <div style={{ marginTop: 8 }}>
            {itemRows.length === 0 ? (
              <Text type="secondary">{t('sales.noProducts')}</Text>
            ) : (
              itemRows.map((row, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder={t('sales.selectProduct')}
                    value={row.productId || undefined}
                    onChange={(v) => {
                      const next = [...itemRows];
                      next[idx] = { ...next[idx], productId: v };
                      setItemRows(next);
                    }}
                    options={products.map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <InputNumber
                    min={1}
                    placeholder={t('sales.qty')}
                    value={row.quantity}
                    onChange={(v) => {
                      const next = [...itemRows];
                      next[idx] = { ...next[idx], quantity: v || undefined };
                      setItemRows(next);
                    }}
                  />
                  <Button danger type="text" onClick={() => setItemRows(itemRows.filter((_, i) => i !== idx))}>
                    {t('common.delete')}
                  </Button>
                </div>
              ))
            )}
            <Button
              type="dashed"
              block
              onClick={() => setItemRows([...itemRows, { productId: '', quantity: 1 }])}
            >
              + {t('sales.addProduct')}
            </Button>
          </div>
        </Form>
      </Spin>
    </AppModal>
  );
};

export default SalesFormModal;
