import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Input, Select, Space, Tag, Modal, Form, message, Popconfirm } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      message.success(t('user.deleteSuccess'));
      fetchUsers();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingUser) {
        const { username, password, ...rest } = values;
        await request.put(`/users/${editingUser.id}`, rest);
        message.success(t('user.updateSuccess'));
      } else {
        await request.post('/users', values);
        message.success(t('user.createSuccess'));
      }
      setModalOpen(false);
      fetchUsers();
    } catch { /* handled */ }
  };

  const statusMap: Record<string, { color: string; text: string }> = {
    ACTIVE: { color: 'green', text: t('user.statusActive') },
    DISABLED: { color: 'red', text: t('user.statusDisabled') },
    LOCKED: { color: 'orange', text: t('user.statusLocked') },
  };

  const columns: ColumnsType<UserRecord> = [
    { title: t('user.username'), dataIndex: 'username', width: 120 },
    { title: t('user.realName'), dataIndex: 'realName', width: 120 },
    { title: t('user.email'), dataIndex: 'email', width: 180, ellipsis: true },
    { title: t('user.phone'), dataIndex: 'phone', width: 130 },
    { title: t('user.role'), dataIndex: ['role', 'name'], width: 120, render: (v) => v || t('common.noData') },
    { title: t('user.dept'), dataIndex: ['department', 'name'], width: 120, render: (v) => v || t('common.noData') },
    {
      title: t('user.status'), dataIndex: 'status', width: 80,
      render: (s: string) => {
        const info = statusMap[s] || { color: 'default', text: s };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: t('user.createdAt'), dataIndex: 'createdAt', width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : t('common.noData'),
    },
    {
      title: t('common.operation'), width: 150, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Popconfirm title={t('user.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div className="page-header"><h2>{t('user.title')}</h2></div>
      <div className="search-bar">
        <Input
          placeholder={t('user.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => { setPage(1); fetchUsers(); }}
          style={{ width: 260 }}
          allowClear
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={() => { setPage(1); fetchUsers(); }}>{t('common.search')}</Button>
        <Button icon={<ReloadOutlined />} onClick={fetchUsers}>{t('common.refresh')}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('user.addTitle')}</Button>
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={{
            current: page, pageSize, total, showSizeChanger: true, showTotal: (count) => t('common.total', { count }),
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </div>

      <Modal
        title={editingUser ? t('user.editTitle') : t('user.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label={t('user.username')} rules={[{ required: true, message: t('user.usernameRequired') }]}>
            <Input disabled={!!editingUser} placeholder={t('user.usernamePlaceholder')} />
          </Form.Item>
          {!editingUser && (
            <Form.Item name="password" label={t('user.password')} rules={[{ required: true, min: 6, message: t('user.passwordRequired') }]}>
              <Input.Password placeholder={t('user.passwordPlaceholder')} />
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
    </>
  );
}
