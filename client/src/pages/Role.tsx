import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, message, Popconfirm, Tree } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SafetyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
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
      message.success('删除成功');
      fetchRoles();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRole) {
        await request.put(`/roles/${editingRole.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/roles', values);
        message.success('创建成功');
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
      message.success('权限分配成功');
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
    { title: '角色名称', dataIndex: 'name', width: 150 },
    { title: '角色编码', dataIndex: 'code', width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '排序', dataIndex: 'sort', width: 80 },
    { title: '用户数', dataIndex: ['_count', 'users'], width: 80 },
    {
      title: '操作', width: 220, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<SafetyOutlined />} onClick={() => openPermModal(record)}>权限</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该角色吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header"><h2>角色管理</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchRoles}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增角色</Button>
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
        title={editingRole ? '编辑角色' : '新增角色'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="角色名称" rules={[{ required: true }]}>
            <Input placeholder="请输入角色名称" />
          </Form.Item>
          <Form.Item name="code" label="角色编码" rules={[{ required: true }]}>
            <Input placeholder="请输入角色编码（如 admin）" disabled={!!editingRole} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="请输入角色描述" rows={3} />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="分配权限"
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
