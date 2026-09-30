import React from 'react';
import { Modal, Form, Input, Select, InputNumber, App } from 'antd';
import { Z_INDEX } from '../../zIndex';
import { userApi, type UserSelectItem } from '../../api/users';

interface DeptRecord {
  id: string;
  name: string;
  code: string;
  /** T1-B 配套：负责人改以 userId 承载（后端为 `Department.leaderId`，非姓名） */
  leaderId: string | null;
  leaderName?: string | null;
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
  const [userOptions, setUserOptions] = React.useState<Array<{ label: string; value: string }>>([]);

  /**
   * 负责人候选：每次打开时拉取「轻量用户列表」（`/users/select`，对所有登录用户开放）。
   * 拉取失败**不阻断**部门表单（仅候选为空），避免因选人接口异常导致无法维护部门。
   */
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    userApi
      .listForSelect()
      .then((res) => {
        if (!alive) return;
        const items: UserSelectItem[] = res.data.data ?? [];
        setUserOptions(items.map((u) => ({ label: u.realName || u.username, value: u.id })));
      })
      .catch(() => {
        /* 静默：不阻断表单 */
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      // 清空语义：antd Select 清空后为 `undefined`，而 Prisma 把 `undefined` 视为「不更新」，
      // 会导致**无法解除负责人**。故统一规整为 `null`（后端 `leaderId` 可空）。
      const payload = { ...values, leaderId: values.leaderId ?? null };
      if (editingDept) {
        await api.update(editingDept.id, payload);
        message.success(t('dept.updateSuccess'));
      } else {
        await api.create(payload);
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
      zIndex={Z_INDEX.overlay}
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
        {/* T1-B 配套：负责人改为「从用户中选择」（提交 leaderId），不再是自由文本姓名 */}
        <Form.Item name="leaderId" label={t('dept.leader')}>
          <Select
            placeholder={t('dept.leaderPlaceholder')}
            allowClear
            showSearch
            optionFilterProp="label"
            options={userOptions}
          />
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
