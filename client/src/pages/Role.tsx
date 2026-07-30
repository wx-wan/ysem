import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Tree } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SafetyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';

interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
  _count: { users: number };
}

interface PermissionNode {
  id: string;
  name: string;
  code: string;
  children?: PermissionNode[];
}

export default function RolePage() {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [permissions, setPermissions] = useState<PermissionNode[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
  const [currentRoleId, setCurrentRoleId] = useState<string>('');
  const [form] = Form.useForm();

  const fetchRoles = async () => {
    setLoading(true);
    try {
      const res = await request.get('/roles');
      setRoles(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchRoles(); }, []);

  const handleAdd = () => {
    setEditingRole(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: RoleRecord) => {
    setEditingRole(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/roles/${id}`);
      message.success(t('role.deleteSuccess'));
      fetchRoles();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRole) {
        await request.put(`/roles/${editingRole.id}`, values);
        message.success(t('role.updateSuccess'));
      } else {
        await request.post('/roles', values);
        message.success(t('role.createSuccess'));
      }
      setModalOpen(false);
      fetchRoles();
    } catch { /* handled */ }
  };

  const openPermModal = async (role: RoleRecord) => {
    setCurrentRoleId(role.id);
    const [permRes, roleRes] = await Promise.all([
      request.get('/permissions/tree'),
      request.get(`/roles/${role.id}`),
    ]);
    setPermissions(permRes.data.data || []);
    const rolePermIds = (roleRes.data.data?.permissions || []).map(
      (p: { permissionId: string }) => p.permissionId
    );
    setCheckedKeys(rolePermIds);
    setPermModalOpen(true);
  };

  const handleAssignPerms = async () => {
    try {
      await request.post(`/roles/${currentRoleId}/permissions`, {
        permissionIds: checkedKeys,
      });
      message.success(t('role.assignSuccess'));
      setPermModalOpen(false);
    } catch { /* handled */ }
  };

  const buildTree = (perms: PermissionNode[]): PermissionNode[] => {
    return perms.map((p) => ({
      ...p,
      key: p.id,
      title: `${p.name} (${p.code})`,
      children: p.children?.length ? buildTree(p.children) : undefined,
    }));
  };

  const columns: ColumnsType<RoleRecord> = [
    { title: t('role.name'), dataIndex: 'name', width: 150 },
    { title: t('role.code'), dataIndex: 'code', width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: t('role.description'), dataIndex: 'description', ellipsis: true },
    { title: t('role.sort'), dataIndex: 'sort', width: 80 },
    { title: t('role.userCount'), dataIndex: ['_count', 'users'], width: 80 },
    {
      title: t('common.operation'), width: 220, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<SafetyOutlined />} onClick={() => openPermModal(record)}>{t('role.permission')}</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Popconfirm title={t('role.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header"><h2>{t('role.title')}</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchRoles}>{t('common.refresh')}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('role.addTitle')}</Button>
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={roles}
          loading={loading}
          pagination={false}
        />
      </div>

      <Modal
        title={editingRole ? t('role.editTitle') : t('role.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
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

      <Modal
        title={t('role.assignPerm')}
        open={permModalOpen}
        onCancel={() => setPermModalOpen(false)}
        onOk={handleAssignPerms}
        width={520}
      >
        <Tree
          checkable
          defaultExpandAll
          checkedKeys={checkedKeys}
          onCheck={(keys) => setCheckedKeys(keys as string[])}
          treeData={buildTree(permissions)}
          style={{ marginTop: 16 }}
        />
      </Modal>
    </>
  );
}
