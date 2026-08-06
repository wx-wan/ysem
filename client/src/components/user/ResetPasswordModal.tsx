import React from 'react';
import { Modal, Form, Input, App, Alert } from 'antd';

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
      {targetUser && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={`${t('user.resetPwdFor')} ${targetUser.realName || targetUser.username}（${targetUser.username}）`}
        />
      )}
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="password"
          label={t('user.resetPwdNew')}
          rules={[{ required: true, min: 6, message: t('user.resetPwdRequired') }]}
        >
          <Input.Password placeholder={t('user.resetPwdNewPlaceholder')} />
        </Form.Item>
        <Form.Item
          name="confirm"
          label={t('user.resetPwdConfirm')}
          rules={[{ required: true, message: t('user.resetPwdConfirmPlaceholder') }]}
        >
          <Input.Password placeholder={t('user.resetPwdConfirmPlaceholder')} />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default ResetPasswordModal;
