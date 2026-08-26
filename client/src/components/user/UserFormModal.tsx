import React from 'react';
import { Modal, Form, Input, Select, App } from 'antd';
import ImageUploadCropper from '../common/ImageUploadCropper';
import { useUserStore } from '../../stores/useUserStore';

interface UserRecord {
  id: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  status: string;
  avatar?: string | null;
  role?: { id: string; name: string } | null;
  department?: { id: string; name: string } | null;
}

interface Props {
  open: boolean;
  editingUser: UserRecord | null;
  roles: Array<{ id: string; name: string }>;
  depts: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSuccess: () => void;
  api: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
  t: (key: string, options?: any) => string;
}

const UserFormModal: React.FC<Props> = React.memo(({ open, editingUser, roles, depts, onClose, onSuccess, api, t }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingUser) {
        const { username, password, ...rest } = values;
        await api.update(editingUser.id, rest);
        message.success(t('user.updateSuccess'));
        // 角色可能被修改：若影响当前登录用户，刷新其会话（权限/数据范围）
        if (rest.roleId && rest.roleId !== editingUser.role?.id) {
          useUserStore.getState().reloadRoleUsers(rest.roleId);
        }
      } else {
        await api.create(values);
        message.success(t('user.createSuccess'));
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
      if (editingUser) {
        form.setFieldsValue({
          username: editingUser.username,
          avatar: editingUser.avatar,
          realName: editingUser.realName,
          email: editingUser.email,
          phone: editingUser.phone,
          status: editingUser.status,
          roleId: editingUser.role?.id,
          departmentId: editingUser.department?.id,
        });
      } else {
        form.resetFields();
      }
    }
  }, [open, editingUser, form]);

  return (
    <Modal
      title={editingUser ? t('user.editTitle') : t('user.addTitle')}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      width={560}
      zIndex={2000}
      forceRender
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="avatar" label={t('user.avatar')} getValueFromEvent={(e) => (typeof e === 'string' ? e : e?.target?.value)}>
          <ImageUploadCropper
            shape="circle"
            aspect={1}
            maxSize={512 * 1024}
            uploadUrl="/upload"
            onUploaded={(url) => form.setFieldValue('avatar', url)}
          />
        </Form.Item>
        <Form.Item name="username" label={t('user.username')} rules={[{ required: true, message: t('user.usernameRequired') }]}>
          <Input disabled={!!editingUser} autoComplete="username" placeholder={t('user.usernamePlaceholder')} />
        </Form.Item>
        {!editingUser && (
          <Form.Item name="password" label={t('user.password')} rules={[{ required: true, min: 6, message: t('user.passwordRequired') }]}>
            <Input.Password autoComplete="new-password" placeholder={t('user.passwordPlaceholder')} />
          </Form.Item>
        )}
        <Form.Item name="realName" label={t('user.realName')} rules={[{ required: true, message: t('user.realNameRequired') }]}>
          <Input placeholder={t('user.realNamePlaceholder')} />
        </Form.Item>
        <Form.Item name="email" label={t('user.email')}>
          <Input placeholder={t('user.emailPlaceholder')} />
        </Form.Item>
        <Form.Item name="phone" label={t('user.phone')}>
          <Input placeholder={t('user.phonePlaceholder')} />
        </Form.Item>
        <Form.Item name="roleId" label={t('user.role')}>
          <Select placeholder={t('user.rolePlaceholder')} allowClear>
            {roles.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}</Select.Option>)}
          </Select>
        </Form.Item>
        <Form.Item name="departmentId" label={t('user.dept')}>
          <Select placeholder={t('user.deptPlaceholder')} allowClear>
            {depts.map((d) => <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>)}
          </Select>
        </Form.Item>
        {editingUser && (
          <Form.Item name="status" label={t('user.status')}>
            <Select>
              <Select.Option value="ACTIVE">{t('user.statusActive')}</Select.Option>
              <Select.Option value="DISABLED">{t('user.statusDisabled')}</Select.Option>
              <Select.Option value="LOCKED">{t('user.statusLocked')}</Select.Option>
            </Select>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
});

export default UserFormModal;
