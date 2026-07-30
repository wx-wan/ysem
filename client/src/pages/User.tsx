import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Input, Select, Space, Tag, Modal, Form, message, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import request from '../api/request';

interface UserRecord {
  id: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  status: string;
  createdAt: string;
  lastLoginAt: string;
  role: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
}

interface RoleOption {
  id: string;
  name: string;
}

interface DeptOption {
  id: string;
  name: string;
}

export default function UserPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [form] = Form.useForm();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get('/users', { params: { page, pageSize, keyword } });
      setUsers(res.data.data.list);
      setTotal(res.data.data.total);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [page, pageSize, keyword]);

  const fetchOptions = async () => {
    const [rolesRes, deptsRes] = await Promise.all([
      request.get('/roles'),
      request.get('/departments'),
    ]);
    setRoles(rolesRes.data.data || []);
    setDepts(deptsRes.data.data || []);
  };

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleAdd = () => {
    setEditingUser(null);
    form.resetFields();
    fetchOptions();
    setModalOpen(true);
  };

  const handleEdit = (record: UserRecord) => {
    setEditingUser(record);
    form.setFieldsValue({
      username: record.username,
      realName: record.realName,
      email: record.email,
      phone: record.phone,
      status: record.status,
      roleId: record.role?.id,
      departmentId: record.department?.id,
    });
    fetchOptions();
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/users/${id}`);
      message.success('删除成功');
      fetchUsers();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingUser) {
        const { username, password, ...rest } = values;
        await request.put(`/users/${editingUser.id}`, rest);
        message.success('更新成功');
      } else {
        await request.post('/users', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchUsers();
    } catch { /* handled */ }
  };

  const statusMap: Record<string, { color: string; text: string }> = {
    ACTIVE: { color: 'green', text: '正常' },
    DISABLED: { color: 'red', text: '禁用' },
    LOCKED: { color: 'orange', text: '锁定' },
  };

  const columns: ColumnsType<UserRecord> = [
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '真实姓名', dataIndex: 'realName', width: 120 },
    { title: '邮箱', dataIndex: 'email', width: 180, ellipsis: true },
    { title: '手机号', dataIndex: 'phone', width: 130 },
    { title: '角色', dataIndex: ['role', 'name'], width: 120, render: (v) => v || '-' },
    { title: '部门', dataIndex: ['department', 'name'], width: 120, render: (v) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (s: string) => {
        const info = statusMap[s] || { color: 'default', text: s };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '创建时间', dataIndex: 'createdAt', width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
    },
    {
      title: '操作', width: 150, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该用户吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header"><h2>用户管理</h2></div>
      <div className="search-bar">
        <Input
          placeholder="搜索用户名/姓名/邮箱"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => { setPage(1); fetchUsers(); }}
          style={{ width: 260 }}
          allowClear
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchUsers(); }}>查询</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchUsers}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增用户</Button>
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page, pageSize, total, showSizeChanger: true, showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </div>

      <Modal
        title={editingUser ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input disabled={!!editingUser} placeholder="请输入用户名" />
          </Form.Item>
          {!editingUser && (
            <Form.Item name="password" label="密码" rules={[{ required: true, min: 6, message: '密码至少6位' }]}>
              <Input.Password placeholder="请输入密码" />
            </Form.Item>
          )}
          <Form.Item name="realName" label="真实姓名" rules={[{ required: true, message: '请输入真实姓名' }]}>
            <Input placeholder="请输入真实姓名" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item name="roleId" label="角色">
            <Select placeholder="请选择角色" allowClear>
              {roles.map((r) => <Select.Option key={r.id} value={r.id}>{r.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="departmentId" label="部门">
            <Select placeholder="请选择部门" allowClear>
              {depts.map((d) => <Select.Option key={d.id} value={d.id}>{d.name}</Select.Option>)}
            </Select>
          </Form.Item>
          {editingUser && (
            <Form.Item name="status" label="状态">
              <Select>
                <Select.Option value="ACTIVE">正常</Select.Option>
                <Select.Option value="DISABLED">禁用</Select.Option>
                <Select.Option value="LOCKED">锁定</Select.Option>
              </Select>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
