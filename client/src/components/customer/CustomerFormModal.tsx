import React from 'react';
import { Modal, Form, Input, Select, Tag, Row, Col, App } from 'antd';
import { customerApi, Customer } from '../../api/customers';
import KeyAccountStar from '../KeyAccountStar';
import TagSelector from '../TagSelector';
import CountrySelect from '../CountrySelect';

const INTENT_OPTIONS = [
  { value: '低意向', label: '低意向', tagColor: 'default' as const },
  { value: '中意向', label: '中意向', tagColor: 'warning' as const },
  { value: '高意向', label: '高意向', tagColor: 'orange' as const },
  { value: '准成交', label: '准成交', tagColor: 'red' as const },
];

interface Props {
  open: boolean;
  editingCustomer: Customer | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CustomerFormModal: React.FC<Props> = React.memo(({ open, editingCustomer, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingCustomer) {
        await customerApi.update(editingCustomer.id, values);
        message.success('更新成功');
      } else {
        await customerApi.create(values);
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
      if (editingCustomer) {
        form.setFieldsValue(editingCustomer);
      } else {
        form.resetFields();
        form.setFieldsValue({ isKeyAccount: false });
      }
    }
  }, [open, editingCustomer, form]);

  return (
    <Modal
      title={editingCustomer ? '编辑客户' : '新增客户'}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      width={640}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
          <Input placeholder="公司名称" />
        </Form.Item>
        <Form.Item name="contactName" label="联系人">
          <Input placeholder="联系人" />
        </Form.Item>
        <Form.Item name="email" label="邮箱">
          <Input placeholder="邮箱" />
        </Form.Item>
        <Form.Item name="phone" label="电话">
          <Input placeholder="电话" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="country" label="国家">
              <CountrySelect />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="source" label="来源">
              <Select placeholder="来源" allowClear>
                <Select.Option value="MANUAL">手动录入</Select.Option>
                <Select.Option value="EXCEL">Excel导入</Select.Option>
                <Select.Option value="XIAOMAN">小满API</Select.Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="isKeyAccount" hidden>
          <Input />
        </Form.Item>
        <Form.Item
          noStyle
          shouldUpdate={(prev, cur) => prev.isKeyAccount !== cur.isKeyAccount}
        >
          {({ getFieldValue, setFieldsValue }) => (
            <Form.Item label="重点客户">
              <KeyAccountStar
                isKeyAccount={getFieldValue('isKeyAccount') || false}
                customerId={editingCustomer?.id}
                onToggle={() => setFieldsValue({ isKeyAccount: !getFieldValue('isKeyAccount') })}
              />
            </Form.Item>
          )}
        </Form.Item>
        <Form.Item name="intentLevel" label="采购意向">
          <Select placeholder="选择采购意向">
            {INTENT_OPTIONS.map((o) => (
              <Select.Option key={o.value} value={o.value}>
                <Tag color={o.tagColor} bordered={false}>{o.label}</Tag>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="tags" style={{ marginBottom: 0 }}>
          <TagSelector placeholder="输入标签名称" />
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <Input.TextArea rows={2} placeholder="备注信息" />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default CustomerFormModal;
