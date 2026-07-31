import React from 'react';
import { Modal, Form, Input, Select, Space, App } from 'antd';
import { orderApi, Order } from '../../api/customers';

interface Props {
  open: boolean;
  editingOrder: Order | null;
  onClose: () => void;
  onSuccess: () => void;
}

const OrderFormModal: React.FC<Props> = React.memo(({ open, editingOrder, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingOrder) {
        await orderApi.update(editingOrder.id, values);
        message.success('更新成功');
      } else {
        await orderApi.create(values);
        message.success('创建成功');
      }
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
      const msg = e?.response?.data?.message || e?.message || '操作失败';
      message.error(msg);
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      if (editingOrder) {
        form.setFieldsValue({ ...editingOrder });
      } else {
        form.resetFields();
        form.setFieldsValue({ status: 'PENDING' });
      }
    }
  }, [open, editingOrder, form]);

  return (
    <Modal
      title={editingOrder ? '编辑订单' : '新增订单'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      width={560}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item
          name="customerId"
          label="客户ID"
          rules={editingOrder ? [] : [{ required: true, message: '请输入客户ID' }]}
        >
          <Input placeholder="从客户详情页复制客户ID" disabled={!!editingOrder} />
        </Form.Item>
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
