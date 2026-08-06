import { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Button, Input, Space, Tag, App, Popconfirm, Pagination } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import UserFormModal from '../components/user/UserFormModal';
import { buildTablePagination } from '../components/common/tablePagination';
import { usePermission } from '../hooks/usePermission';

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

const userApi = {
  create: (data: any) => request.post('/users', data),
  update: (id: string, data: any) => request.put(`/users/${id}`, data),
};

export default function UserPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();
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
    fetchOptions();
    setModalOpen(true);
  };

  const handleEdit = (record: UserRecord) => {
    setEditingUser(record);
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

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingUser(null);
  };

  const statusMap = useMemo<Record<string, { color: string; text: string }>>(() => ({
    ACTIVE: { color: 'green', text: t('user.statusActive') },
    DISABLED: { color: 'red', text: t('user.statusDisabled') },
    LOCKED: { color: 'orange', text: t('user.statusLocked') },
  }), [t]);

  const columns: ColumnsType<UserRecord> = useMemo(() => [
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
          {hasPerm('system:user:edit') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          )}
          {hasPerm('system:user:delete') && (
            <Popconfirm title={t('user.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, statusMap, hasPerm]);

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
        {hasPerm('system:user:create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>{t('user.addTitle')}</Button>
        )}
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 1100 }}
          pagination={false}
        />
      </div>

      {total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
          <Pagination
            {...buildTablePagination({
              total, page, pageSize,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            })}
          />
        </div>
      )}

      <UserFormModal
        open={modalOpen}
        editingUser={editingUser}
        roles={roles}
        depts={depts}
        onClose={handleModalClose}
        onSuccess={fetchUsers}
        api={userApi}
        t={t}
      />
    </>
  );
}
