import React from 'react';
import { Modal, Form, Input, Select, InputNumber, App } from 'antd';
import { Z_INDEX } from '../../zIndex';

interface PermRecord {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId: string | null;
  sort: number;
  path: string;
  icon: string;
}

interface Props {
  open: boolean;
  editingPerm: PermRecord | null;
  parentOptions: Array<{ label: string; value: string }>;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
  initialParentId?: string;
  initialType?: string;
}

const PermFormModal: React.FC<Props> = React.memo(({ open, editingPerm, parentOptions, onClose, onSuccess, api, t, initialParentId, initialType }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingPerm) {
        await api.update(editingPerm.id, values);
        message.success(t('perm.updateSuccess'));
      } else {
        await api.create(values);
        message.success(t('perm.createSuccess'));
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
      if (editingPerm) {
        form.setFieldsValue(editingPerm);
      } else {
        form.resetFields();
        if (initialParentId) form.setFieldValue('parentId', initialParentId);
        if (initialType) form.setFieldValue('type', initialType);
      }
    }
  }, [open, editingPerm, form, initialParentId, initialType]);

  return (
    <Modal
      title={editingPerm ? t('perm.editTitle') : t('perm.addTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      zIndex={Z_INDEX.overlay}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="name" label={t('perm.name')} rules={[{ required: true, message: t('perm.nameRequired') }]}>
          <Input placeholder={t('perm.namePlaceholder')} />
        </Form.Item>
        <Form.Item name="code" label={t('perm.code')} rules={[{ required: true, message: t('perm.codeRequired') }]}>
          <Input placeholder={t('perm.codePlaceholder')} disabled={!!editingPerm} />
        </Form.Item>
        <Form.Item name="type" label={t('perm.type')} rules={[{ required: true }]}>
          <Select>
            <Select.Option value="MENU">{t('perm.typeMenu')}</Select.Option>
            <Select.Option value="BUTTON">{t('perm.typeButton')}</Select.Option>
            <Select.Option value="API">{t('perm.typeApi')}</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="parentId" label={t('perm.parentMenu')}>
          <Select placeholder={t('perm.parentPlaceholder')} allowClear options={parentOptions} />
        </Form.Item>
        <Form.Item name="path" label={t('perm.path')}>
          <Input placeholder={t('perm.pathPlaceholder')} />
        </Form.Item>
        <Form.Item name="icon" label={t('perm.icon')}>
          <Input placeholder={t('perm.iconPlaceholder')} />
        </Form.Item>
        <Form.Item name="sort" label={t('perm.sort')}>
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default PermFormModal;
