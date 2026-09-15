import React from 'react';
import { Alert, App, Form, Input, Modal, Select, Space } from 'antd';
import { Customer } from '../../../api/customers';
import { salesApi, SalesItem } from '../../../api/sales';
import { salesOrderApi, SALES_ORDER_STATUS_TEXT, type SalesOrderStatus } from '../../../api/salesOrders';
import { Z_INDEX } from '../../../zIndex';

/**
 * 客户详情 → 新增销售订单（V1.0）
 *
 * ADR-6B-01：创建 SalesOrder 时 Opportunity 为必选上下文（V1.0 `SalesOrder.opportunityId` 必填）。
 * 本弹窗已脱离 legacy `/api/orders`（旧 `orderApi.create` + 旧 DRAFT/SUBMITTED/APPROVED/REJECTED 审批态）。
 *
 * 与旧实现的差异（均为 V1.0 契约强制）：
 *   - 订单号：由后端 NumberSequence 生成（SO-yyyyMMdd-####）→ 前端不再有 orderNo 输入；
 *   - 金额：`amountCNY` → `totalAmount`（Decimal）；币种使用后端默认（不构造 amountCNY）；
 *   - 备注：`notes` → `remark`（旧后端只读 remark，旧 notes 会被静默丢弃）；
 *   - 状态：旧 PENDING/CONFIRMED/IN_PRODUCTION/SHIPPED/DELIVERED（非任何后端枚举）
 *           → V1.0 `SalesOrderStatus`，默认 DRAFT（与后端 server default 一致）。
 */

interface Props {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSuccess: () => void;
}

const STATUS_OPTIONS = (Object.keys(SALES_ORDER_STATUS_TEXT) as SalesOrderStatus[]).map((s) => ({
  label: SALES_ORDER_STATUS_TEXT[s],
  value: s,
}));

const OrderFormModal: React.FC<Props> = React.memo(({ open, customer, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);
  const [opportunities, setOpportunities] = React.useState<SalesItem[]>([]);
  const [oppLoading, setOppLoading] = React.useState(false);

  // 商机数据源：仅当前客户的商机（salesApi.listByCustomer）。
  // 切换客户 → 清空表单与商机列表并重新加载，避免残留其它客户的 opportunityId。
  React.useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ status: 'DRAFT' });

    const customerId = customer?.id;
    if (!customerId) {
      setOpportunities([]);
      return;
    }
    setOppLoading(true);
    salesApi
      .listByCustomer(customerId)
      .then((res) => setOpportunities(res.data?.data ?? []))
      .catch((err) => {
        console.warn('[OrderFormModal] 加载客户商机失败', err);
        setOpportunities([]);
      })
      .finally(() => setOppLoading(false));
  }, [open, customer?.id, form]);

  const noOpportunity = !oppLoading && opportunities.length === 0;

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (!customer?.id) {
        message.error('缺少客户信息');
        return;
      }
      setSaving(true);
      await salesOrderApi.create({
        opportunityId: values.opportunityId,
        customerId: customer.id,
        orderDate: values.orderDate || null,
        deliveryDate: values.deliveryDate || null,
        paymentTerms: values.paymentTerms || null,
        totalAmount:
          values.totalAmount === undefined || values.totalAmount === null || values.totalAmount === ''
            ? undefined
            : Number(values.totalAmount),
        status: values.status,
        remark: values.remark || null,
      });
      message.success('创建成功');
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e?.response?.data?.message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={customer?.companyName ? `新增销售订单 - ${customer.companyName}` : '新增销售订单'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      width={560}
      zIndex={Z_INDEX.overlay}
      forceRender
      okButtonProps={{ disabled: noOpportunity || oppLoading }}
    >
      {noOpportunity && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="该客户暂无商机，请先创建商机"
          description="V1.0 销售订单必须归属一个商机，无法在没有商机的情况下创建。"
        />
      )}
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="opportunityId"
          label="商机"
          rules={[{ required: true, message: '请选择商机' }]}
        >
          <Select
            showSearch
            allowClear
            loading={oppLoading}
            disabled={!customer?.id}
            placeholder={customer?.id ? '选择该客户下的商机' : '请先选择客户'}
            optionFilterProp="label"
            options={opportunities.map((o) => ({
              label: `${o.opportunityNo || ''} ${o.title || ''}`.trim(),
              value: o.id,
            }))}
          />
        </Form.Item>
        <div style={{ fontSize: 12, color: 'var(--c-text-secondary, rgba(0,0,0,.45))', marginBottom: 12 }}>
          订单号由系统自动生成（SO-yyyyMMdd-####），金额币种默认取服务端默认值。
        </div>
        <Space style={{ width: '100%' }} size={16}>
          <Form.Item name="orderDate" label="订单日期" style={{ width: 170 }}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="totalAmount" label="金额" style={{ width: 170 }}>
            <Input type="number" placeholder="0.00" />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ width: 170 }}>
            <Select options={STATUS_OPTIONS} />
          </Form.Item>
        </Space>
        <Space style={{ width: '100%' }} size={16}>
          <Form.Item name="deliveryDate" label="交付日期" style={{ width: 170 }}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="paymentTerms" label="付款条件" style={{ width: 170 }}>
            <Input placeholder="如 T/T 30%" />
          </Form.Item>
        </Space>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} placeholder="备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default OrderFormModal;
