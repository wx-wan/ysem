import React from 'react';
import { Modal, Form, Input, InputNumber, App } from 'antd';

interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
}

interface Props {
  open: boolean;
  editingRole: RoleRecord | null;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
}

const RoleFormModal: React.FC<Props> = React.memo(({ open, editingRole, onClose, onSuccess, api, t }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingRole) {
        await api.update(editingRole.id, values);
        message.success(t('role.updateSuccess'));
      } else {
        await api.create(values);
        message.success(t('role.createSuccess'));
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
      if (editingRole) {
        form.setFieldsValue(editingRole);
      } else {
        form.resetFields();
      }
    }
  }, [open, editingRole, form]);

  return (
    <Modal
      title={editingRole ? t('role.editTitle') : t('role.addTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('role.name')} rules={[{ required: true, message: t('role.nameRequired') }]}>
          <Input placeholder={t('role.namePlaceholder')} />
        </Form.Item>
        <Form.Item name="code" label={t('role.code')} rules={[{ required: true, message: t('role.codeRequired') }]}>
          <Input placeholder={t('role.codePlaceholder')} disabled={!!editingRole} />
        </Form.Item>
        <Form.Item name="description" label={t('role.description')}>
          <Input.TextArea placeholder={t('role.descPlaceholder')} rows={3} />
        </Form.Item>
        <Form.Item name="sort" label={t('role.sort')}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default RoleFormModal;
