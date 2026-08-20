import React from 'react';
import { Modal, Form, Input, App } from 'antd';

interface UserRecord {
  id: string;
  username: string;
  realName: string;
}

interface Props {
  open: boolean;
  targetUser: UserRecord | null;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    resetPassword: (id: string, password: string) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
}

const ResetPasswordModal: React.FC<Props> = React.memo(({ open, targetUser, onClose, onSuccess, api, t }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (values.password !== values.confirm) {
        message.error(t('user.resetPwdMismatch'));
        return;
      }
      setSaving(true);
      await api.resetPassword(targetUser!.id, values.password);
      message.success(t('user.resetPwdSuccess'));
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) form.resetFields();
  }, [open, form]);

  return (
    <Modal
      title={t('user.resetPwdTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      width={520}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        {targetUser && (
          <Form.Item label={t('user.username')} style={{ marginBottom: 16 }}>
            <Input
              value={targetUser.username}
              readOnly
              autoComplete="username"
              style={{ background: 'transparent', borderColor: 'transparent', paddingLeft: 0, color: 'inherit' }}
            />
          </Form.Item>
        )}
        <Form.Item
          name="password"
          label={t('user.resetPwdNew')}
          rules={[{ required: true, min: 6, message: t('user.resetPwdRequired') }]}
        >
          <Input.Password autoComplete="new-password" placeholder={t('user.resetPwdNewPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('user.resetPwdConfirm')}
          rules={[{ required: true, message: t('user.resetPwdConfirmPlaceholder') }]}
        >
          <Input.Password autoComplete="new-password" placeholder={t('user.resetPwdConfirmPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default ResetPasswordModal;
