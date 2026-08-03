import React from 'react';
import { Modal, Form, Input, Select, Space, App } from 'antd';
import { orderApi, Customer } from '../../../api/customers';

interface Props {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onSuccess: () => void;
}

const OrderFormModal: React.FC<Props> = React.memo(({ open, customer, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await orderApi.create({ ...values, customerId: customer!.id });
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

  React.useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue({ status: 'PENDING' });
    }
  }, [open, form]);

  return (
    <Modal
      title={customer?.companyName ? `新增订单 - ${customer.companyName}` : '新增订单'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      width={560}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Space style={{ width: '100%' }} size={16}>
          <Form.Item name="orderNo" label="订单号" style={{ width: 170 }}>
            <Input placeholder="订单号" />
          </Form.Item>
          <Form.Item name="orderDate" label="订单日期" style={{ width: 170 }}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="amountCNY" label="金额（CNY）" style={{ width: 170 }}>
            <Input type="number" placeholder="0.00" />
          </Form.Item>
        </Space>
        <Space style={{ width: '100%' }} size={16}>
          <Form.Item name="deliveryDate" label="交付日期" style={{ width: 170 }}>
            <Input type="date" />
          </Form.Item>
          <Form.Item name="paymentTerms" label="付款条件" style={{ width: 170 }}>
            <Input placeholder="如 T/T 30%" />
          </Form.Item>
          <Form.Item name="status" label="状态" style={{ width: 170 }}>
            <Select>
              <Select.Option value="PENDING">待确认</Select.Option>
              <Select.Option value="CONFIRMED">已确认</Select.Option>
              <Select.Option value="IN_PRODUCTION">生产中</Select.Option>
              <Select.Option value="SHIPPED">已发货</Select.Option>
              <Select.Option value="DELIVERED">已交付</Select.Option>
            </Select>
          </Form.Item>
        </Space>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} placeholder="备注" />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default OrderFormModal;
