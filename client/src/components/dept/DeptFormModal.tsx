import React from 'react';
import { Modal, Form, Input, Select, InputNumber, App } from 'antd';

interface DeptRecord {
  id: string;
  name: string;
  code: string;
  leader: string;
  phone: string;
  email: string;
  sort: number;
  status: number;
  parentId: string | null;
}

interface Props {
  open: boolean;
  editingDept: DeptRecord | null;
  parentOptions: Array<{ label: string; value: string }>;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
  initialParentId?: string;
}

const DeptFormModal: React.FC<Props> = React.memo(({ open, editingDept, parentOptions, onClose, onSuccess, api, t, initialParentId }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingDept) {
        await api.update(editingDept.id, values);
        message.success(t('dept.updateSuccess'));
      } else {
        await api.create(values);
        message.success(t('dept.createSuccess'));
      }
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      if (editingDept) {
        form.setFieldsValue(editingDept);
      } else {
        form.resetFields();
        if (initialParentId) form.setFieldValue('parentId', initialParentId);
      }
    }
  }, [open, editingDept, form, initialParentId]);

  return (
    <Modal
      title={editingDept ? t('dept.editTitle') : t('dept.addTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('dept.name')} rules={[{ required: true, message: t('dept.nameRequired') }]}>
          <Input placeholder={t('dept.namePlaceholder')} />
        </Form.Item>
        <Form.Item name="code" label={t('dept.code')} rules={[{ required: true, message: t('dept.codeRequired') }]}>
          <Input placeholder={t('dept.codePlaceholder')} disabled={!!editingDept} />
        </Form.Item>
        <Form.Item name="parentId" label={t('dept.parentDept')}>
          <Select placeholder={t('dept.parentPlaceholder')} allowClear options={parentOptions} />
        </Form.Item>
        <Form.Item name="leader" label={t('dept.leader')}>
          <Input placeholder={t('dept.leaderPlaceholder')} />
        </Form.Item>
        <Form.Item name="phone" label={t('dept.phone')}>
          <Input placeholder={t('dept.phonePlaceholder')} />
        </Form.Item>
        <Form.Item name="email" label={t('dept.email')}>
          <Input placeholder={t('dept.emailPlaceholder')} />
        </Form.Item>
        <Form.Item name="sort" label={t('dept.sort')}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="status" label={t('dept.status')}>
          <Select>
            <Select.Option value={1}>{t('dept.statusEnabled')}</Select.Option>
            <Select.Option value={0}>{t('dept.statusDisabled')}</Select.Option>
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default DeptFormModal;
