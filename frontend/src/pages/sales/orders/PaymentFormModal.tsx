import { Alert, App, Form, Input, InputNumber, Modal, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { createPayment } from '../../../api/payments';
import { getErrorMessage } from '../../../api/request';
import type { Currency } from '../../../types/payment';
import type { PaymentListItem, PaymentType } from '../../../types/payment';
import type { SalesOrderDetail } from '../../../types/salesOrder';
import { formatDecimalString } from '../../../utils/format';
import { ORDER_CURRENCY_OPTIONS } from './constants';

const { Text } = Typography;

interface PaymentFormValues {
  amount?: number;
  currency?: Currency;
  type?: PaymentType;
  payDate?: string;
  method?: string;
  bankAccount?: string;
  remark?: string;
}

export interface PaymentFormModalProps {
  open: boolean;
  /** 目标销售订单（收款宿主；客户由后端按订单推导并校验一致性） */
  order: SalesOrderDetail | null;
  onCancel: () => void;
  onSaved: (payment: PaymentListItem) => void;
}

const PAYMENT_TYPE_OPTIONS: { label: string; value: PaymentType }[] = [
  { label: '定金', value: 'DEPOSIT' },
  { label: '尾款', value: 'BALANCE' },
  { label: '全款', value: 'FULL' },
  { label: '其他', value: 'OTHER' },
];

/**
 * 收款登记表单（Round F-S6）
 *
 * 合同（payment.controller createSchema L51-67 / create L368-452）：
 *   · `direction` 固定 **IN**（收款）；`purchaseOrderId` 不得提交；`customerId` 由后端按订单推导并校验一致性；
 *   · ★ `status` **必须显式 CONFIRMED**：模型默认 PENDING，而 `SalesOrder.paidAmountCny` 只统计
 *     `direction=IN AND status=CONFIRMED` 的收款 ⇒ 若不显式确认，已收累计恒为 0（硬合同）；
 *   · 金额 > 0（后端 `round(amount)` 后判非法）；汇率由后端解析（不提交 exchangeRate）；
 *   · 创建成功后后端在**同一事务**内重算 `SalesOrder.paidAmountCny`（前端不回写、不计算）。
 */
export default function PaymentFormModal({ open, order, onCancel, onSaved }: PaymentFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<PaymentFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    form.resetFields();
    form.setFieldsValue({ currency: order?.currency ?? 'USD', type: 'OTHER' });
  }, [open, order, form]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: PaymentFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!order) {
      setError('缺少目标销售订单');
      return;
    }

    setSubmitting(true);
    try {
      const saved = await createPayment({
        direction: 'IN',
        salesOrderId: order.id,
        amount: values.amount as number,
        // ★ 硬合同：收款创建即 CONFIRMED，否则不计入 paidAmountCny
        status: 'CONFIRMED',
        type: values.type ?? 'OTHER',
        currency: values.currency ?? order.currency,
        payDate: values.payDate ?? null,
        method: values.method?.trim() ? values.method.trim() : null,
        bankAccount: values.bankAccount?.trim() ? values.bankAccount.trim() : null,
        remark: values.remark?.trim() ? values.remark.trim() : null,
      });
      message.success('收款登记成功');
      form.resetFields();
      onSaved(saved);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, order, message, onSaved]);

  return (
    <Modal
      open={open}
      title="登记收款"
      width={640}
      okText="登记"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={() => void handleSubmit()}
      onCancel={() => {
        setError(null);
        onCancel();
      }}
    >
      {error ? <Alert type="error" showIcon title="登记收款失败" description={error} style={{ marginBottom: 12 }} /> : null}

      <Alert
        type="info"
        showIcon
        title="收款即确认"
        description="收款单创建后状态为「已确认」，订单的「已收（CNY）」由后端按已确认收款自动汇总。"
        style={{ marginBottom: 12 }}
      />

      <Form<PaymentFormValues> form={form} layout="vertical">
        <Space size={12} wrap style={{ display: 'flex' }}>
          <Form.Item label="销售订单" style={{ minWidth: 220, marginBottom: 12 }}>
            <Input readOnly value={order ? `${order.orderNo}（${order.status}）` : ''} />
          </Form.Item>
          <Form.Item label="客户" style={{ minWidth: 200, marginBottom: 12 }}>
            <Input readOnly value={order?.customer.companyName ?? ''} />
          </Form.Item>
          <Form.Item label="订单金额 / 已收（CNY）" style={{ minWidth: 220, marginBottom: 12 }}>
            <Input
              readOnly
              value={
                order
                  ? `${order.currency} ${formatDecimalString(order.totalAmount)} / ${formatDecimalString(order.paidAmountCny)}`
                  : ''
              }
            />
          </Form.Item>
        </Space>

        <Space size={12} wrap style={{ display: 'flex' }}>
          <Form.Item
            name="amount"
            label="收款金额"
            rules={[
              { required: true, message: '请输入收款金额' },
              {
                validator: (_r, value: number | undefined) =>
                  typeof value === 'number' && value > 0
                    ? Promise.resolve()
                    : Promise.reject(new Error('金额必须大于 0')),
              },
            ]}
            style={{ width: 200, marginBottom: 12 }}
          >
            <InputNumber min={0.000001} step={0.01} style={{ width: '100%' }} placeholder="金额" />
          </Form.Item>
          <Form.Item name="currency" label="币种" style={{ width: 180, marginBottom: 12 }}>
            <Select options={ORDER_CURRENCY_OPTIONS} placeholder="币种" />
          </Form.Item>
          <Form.Item name="type" label="款项类型" style={{ width: 160, marginBottom: 12 }}>
            <Select options={PAYMENT_TYPE_OPTIONS} placeholder="款项类型" />
          </Form.Item>
          <Form.Item name="payDate" label="收款日期" style={{ width: 180, marginBottom: 12 }}>
            <Input type="date" />
          </Form.Item>
        </Space>

        <Space size={12} wrap style={{ display: 'flex' }}>
          <Form.Item name="method" label="收款方式" style={{ width: 200, marginBottom: 12 }}>
            <Input maxLength={50} placeholder="T/T / L/C / 现金…" />
          </Form.Item>
          <Form.Item name="bankAccount" label="银行账户" style={{ width: 260, marginBottom: 12 }}>
            <Input maxLength={100} />
          </Form.Item>
        </Space>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>

        <Text type="secondary">付款（OUT）不在本阶段范围；收款不得关联采购单。</Text>
      </Form>
    </Modal>
  );
}
