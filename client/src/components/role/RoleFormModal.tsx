import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Form, Input, InputNumber, App, Checkbox, Row, Col, Divider, Card, Space, Select,
} from 'antd';
import type { TFunction } from 'i18next';
import { useUserStore } from '../../stores/useUserStore';
import type { CheckboxChangeEvent } from 'antd/es/checkbox';

interface PermNode {
  id: string;
  name: string;
  code: string;
  type: string;
  children?: PermNode[];
}

interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
  dataScope?: string;
}

// 角色数据范围（与服务端 utils/scope.ts 的 DATA_SCOPES 保持一致）
const DATA_SCOPE_OPTIONS: { value: string; i18nKey: string }[] = [
  { value: 'ALL', i18nKey: 'role.dataScopeAll' },
  { value: 'DEPT', i18nKey: 'role.dataScopeDept' },
  { value: 'SELF', i18nKey: 'role.dataScopeSelf' },
];

interface Props {
  open: boolean;
  editingRole: RoleRecord | null;
  viewRole: RoleRecord | null;
  onClose: () => void;
  onSuccess: () => void;
  roleApi: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
  permApi: {
    getPermissions: () => Promise<any>;
    getRole: (id: string) => Promise<any>;
    assign: (roleId: string, permissionIds: string[]) => Promise<any>;
  };
  t: TFunction;
}

// 收集节点及其所有后代（扁平）
const collectDescendants = (node: PermNode): PermNode[] => {
  const out: PermNode[] = [node];
  if (node.children) {
    node.children.forEach((c) => out.push(...collectDescendants(c)));
  }
  return out;
};

export default function RoleFormModal({
  open, editingRole, viewRole, onClose, onSuccess, roleApi, permApi, t,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [permTree, setPermTree] = useState<PermNode[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const isView = !!viewRole;
  const isEdit = !!editingRole;
  // 超级管理员角色：默认拥有全部权限且不可更改
  const isAdminRole = (editingRole?.code === 'admin') || (viewRole?.code === 'admin');

  // 加载权限树 + 角色详情
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const init = async () => {
      try {
        const [permRes, roleRes] = await Promise.all([
          permApi.getPermissions(),
          isEdit || isView ? permApi.getRole((editingRole ?? viewRole)!.id) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const tree = permRes.data.data || [];
        setPermTree(tree);
        if (roleRes) {
          const data = roleRes.data.data;
          form.setFieldsValue({
            name: data.name,
            code: data.code,
            description: data.description,
            sort: data.sort,
            dataScope: data.dataScope || 'SELF',
          });
        }
        if (isAdminRole) {
          // 超级管理员：默认全选全部权限，不可更改
          const all = new Set<string>();
          tree.forEach((top: PermNode) => collectDescendants(top).forEach((n) => all.add(n.id)));
          setCheckedIds(all);
        } else if (roleRes) {
          const data = roleRes.data.data;
          const ids = new Set<string>(
            (data.permissions || []).map((p: any) => p.permission?.id).filter(Boolean)
          );
          setCheckedIds(ids);
        } else {
          form.resetFields();
          setCheckedIds(new Set());
        }
      } catch { /* handled */ }
    };

    init();
    return () => { cancelled = true; };
  }, [open, editingRole, viewRole]);

  // 按顶级节点分组
  const groups = useMemo(() => {
    return permTree.map((top) => ({
      top,
      list: collectDescendants(top),
    }));
  }, [permTree]);

  const toggleId = (id: string, checked: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleGroupCheck = (group: { top: PermNode; list: PermNode[] }, e: CheckboxChangeEvent) => {
    const checked = e.target.checked;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      group.list.forEach((n) => {
        if (checked) next.add(n.id);
        else next.delete(n.id);
      });
      return next;
    });
  };

  const handleSave = async () => {
    if (isView) { onClose(); return; }
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      let roleId: string;
      if (isEdit) {
        const res = await roleApi.update(editingRole!.id, values);
        roleId = res.data.data.id;
      } else {
        const res = await roleApi.create(values);
        roleId = res.data.data.id;
      }

      await permApi.assign(roleId, Array.from(checkedIds));
      message.success(isEdit ? t('role.updateSuccess') : t('role.createSuccess'));
      // 角色权限/数据范围变更：刷新属于该角色的当前用户会话
      useUserStore.getState().reloadRoleUsers(roleId);
      onSuccess();
      onClose();
    } catch { /* handled */ }
    finally { setSubmitting(false); }
  };

  const title = isView ? t('role.view') : isEdit ? t('common.edit') : t('role.addTitle');

  return (
    <Modal
      open={open}
      title={title}
      width={900}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={submitting}
      okButtonProps={{ disabled: isView }}
      okText={t('role.save')}
      cancelText={t('common.cancel')}
    >
      {/* 基本信息 */}
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('role.basicInfo')}</div>
      <Form form={form} layout="vertical" disabled={isView || isAdminRole}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="name"
              label={t('role.name')}
              rules={[{ required: true, message: t('role.nameRequired') }]}
            >
              <Input placeholder={t('role.name')} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="code"
              label={t('role.code')}
              rules={[{ required: !isEdit, message: t('role.codeRequired') }]}
            >
              <Input disabled={isEdit} placeholder={t('role.code')} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="description" label={t('role.description')}>
              <Input.TextArea rows={2} placeholder={t('role.description')} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="dataScope"
              label={t('role.dataScope')}
              initialValue="SELF"
              extra={t('role.dataScopeTip')}
            >
              <Select
                placeholder={t('role.dataScope')}
                options={DATA_SCOPE_OPTIONS.map((o) => ({ label: t(o.i18nKey), value: o.value }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="sort" label={t('role.sort')} initialValue={0} style={{ display: 'none' }}>
          <InputNumber />
        </Form.Item>
      </Form>

      <Divider style={{ margin: '16px 0' }} />

      {/* 权限配置 */}
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('role.permConfig')}</div>
      {isAdminRole && (
        <div className="admin-perm-lock">{t('role.adminPermLocked')}</div>
      )}
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        {groups.map((group) => {
          const allIds = group.list.map((n) => n.id);
          const checkedCount = allIds.filter((id) => checkedIds.has(id)).length;
          const groupChecked = checkedCount === allIds.length && allIds.length > 0;
          const groupIndeterminate = checkedCount > 0 && checkedCount < allIds.length;

          // 子权限排除顶级节点本身（因为顶部已用 Checkbox 表示）
          const children = group.list.filter((n) => n.id !== group.top.id);

          return (
            <Card
              key={group.top.id}
              size="small"
              title={
                <Checkbox
                  checked={groupChecked}
                  indeterminate={groupIndeterminate}
                  onChange={(e) => handleGroupCheck(group, e)}
                  disabled={isView || isAdminRole}
                >
                  <span style={{ fontWeight: 500 }}>{group.top.name}</span>
                </Checkbox>
              }
              styles={{ body: { padding: '12px 16px' } }}
            >
              {children.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px 16px' }}>
                  {children.map((node) => (
                    <Checkbox
                      key={node.id}
                      checked={checkedIds.has(node.id)}
                      onChange={(e) => toggleId(node.id, e.target.checked)}
                      disabled={isView || isAdminRole}
                    >
                      {node.name}
                    </Checkbox>
                  ))}
                </div>
              ) : (
                <span style={{ color: '#999', fontSize: 12 }}>无子权限</span>
              )}
            </Card>
          );
        })}
        {groups.length === 0 && (
          <div style={{ color: '#999', textAlign: 'center', padding: 24 }}>{t('common.noData')}</div>
        )}
      </Space>
    </Modal>
  );
}
