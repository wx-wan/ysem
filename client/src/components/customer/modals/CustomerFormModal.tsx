import React from 'react';
import { Button, Form, Input, DatePicker, Row, Col, App } from 'antd';
import dayjs from 'dayjs';
import { customerApi, Customer } from '../../../api/customers';
import AppModal from '../../AppModal';
import CountrySelect from '../../CountrySelect';
import CustomerTypeSelect from '../../CustomerTypeSelect';

interface Props {
  open: boolean;
  editingCustomer: Customer | null;
  /** 新增模式下预填的公司名称（用于线索建档等场景带入） */
  initialCompanyName?: string;
  onClose: () => void;
  /** 保存成功后回调；新建成功时携带新客户对象 */
  onSuccess?: (customer?: Customer) => void;
}

const CustomerFormModal: React.FC<Props> = React.memo(({ open, editingCustomer, initialCompanyName, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (values.firstOrderDate && dayjs.isDayjs(values.firstOrderDate)) {
        values.firstOrderDate = values.firstOrderDate.format('YYYY-MM-DD');
      }
      setSaving(true);
      if (editingCustomer) {
        await customerApi.update(editingCustomer.id, values);
        message.success('更新成功');
        onClose();
        onSuccess?.();
      } else {
        const res = await customerApi.create(values);
        message.success('创建成功');
        onClose();
        onSuccess?.(res.data.data);
      }
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
      if (editingCustomer) {
        form.setFieldsValue(editingCustomer);
      } else {
        form.resetFields();
        form.setFieldsValue({ isKeyAccount: false, ...(initialCompanyName ? { companyName: initialCompanyName } : {}) });
      }
    }
  }, [open, editingCustomer, initialCompanyName, form]);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={editingCustomer ? '编辑客户' : '新增客户'}
      width={640}
      bodyPadding={20}
      footer={
        <>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存
          </Button>
        </>
      }
    >
      <Form form={form} layout="vertical">
        <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
          <Input placeholder="公司名称" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="contactName" label="联系人">
              <Input placeholder="联系人" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="position" label="职位">
              <Input placeholder="职位" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="country" label="国家">
          <CountrySelect />
        </Form.Item>
        <Form.Item name="customerType" label="客户类型">
          <CustomerTypeSelect placeholder="请选择客户类型" />
        </Form.Item>
        <Form.Item name="email" label="邮箱">
          <Input placeholder="邮箱" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="phone" label="电话">
              <Input placeholder="电话" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="wechat" label="微信">
              <Input placeholder="微信" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="firstOrderDate" label="首次合作日期">
          <DatePicker style={{ width: '100%' }} placeholder="首次合作日期" />
        </Form.Item>
        <Form.Item name="isKeyAccount" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} placeholder="备注信息" />
        </Form.Item>
      </Form>
    </AppModal>
  );
});

export default CustomerFormModal;
