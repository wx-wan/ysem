import { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Button, Input, Space, Tag, App, Popconfirm, Pagination, Segmented, Tooltip, Avatar, Empty } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, KeyOutlined, UserOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import UserFormModal from '../components/user/UserFormModal';
import ResetPasswordModal from '../components/user/ResetPasswordModal';
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
  resetPassword: (id: string, password: string) => request.post(`/users/${id}/reset-password`, { password }),
};

const STATUS_META: Record<string, { color: string; bg: string; text: string }> = {
  ACTIVE: { color: '#10b981', bg: 'rgba(16,185,129,0.10)', text: 'user.statusActive' },
  DISABLED: { color: '#ef4444', bg: 'rgba(239,68,68,0.10)', text: 'user.statusDisabled' },
  LOCKED: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', text: 'user.statusLocked' },
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
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize), keyword };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await request.get('/users', { params });
      setUsers(res.data.data.list);
      setTotal(res.data.data.total);
    } catch { /* handled */ }
    finally { setLoading(false); }
  }, [page, pageSize, keyword, statusFilter]);

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

  const handleResetPwd = (record: UserRecord) => {
    setResetTarget(record);
    setResetOpen(true);
  };

  const handleResetClose = () => {
    setResetOpen(false);
    setResetTarget(null);
  };

  const statusOptions = useMemo(() => [
    { label: t('common.all'), value: 'ALL' },
    { label: t('user.statusActive'), value: 'ACTIVE' },
    { label: t('user.statusDisabled'), value: 'DISABLED' },
    { label: t('user.statusLocked'), value: 'LOCKED' },
  ], [t]);

  const columns: ColumnsType<UserRecord> = useMemo(() => [
    {
      title: t('user.username'),
      dataIndex: 'username',
      width: 220,
      render: (_: string, record) => (
        <div className="user-cell">
          <Avatar size={36} className="user-cell-avatar" icon={<UserOutlined />}>
            {(record.realName || record.username).slice(0, 1).toUpperCase()}
          </Avatar>
          <div className="user-cell-info">
            <span className="user-cell-name">{record.realName || record.username}</span>
            <span className="user-cell-sub">@{record.username}</span>
          </div>
        </div>
      ),
    },
    { title: t('user.email'), dataIndex: 'email', width: 200, ellipsis: true, render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span> },
    { title: t('user.phone'), dataIndex: 'phone', width: 140, render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span> },
    {
      title: t('user.role'),
      dataIndex: ['role', 'name'],
      width: 120,
      render: (v: string) => v
        ? <Tag className="role-tag">{v}</Tag>
        : <span className="cell-muted">{t('common.noData')}</span>,
    },
    {
      title: t('user.dept'),
      dataIndex: ['department', 'name'],
      width: 130,
      render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span>,
    },
    {
      title: t('user.status'),
      dataIndex: 'status',
      width: 100,
      render: (s: string) => {
        const meta = STATUS_META[s] || { color: '#94a3b8', bg: '#f1f5f9', text: s };
        return (
          <span className="status-pill" style={{ color: meta.color, background: meta.bg }}>
            <span className="status-dot" style={{ background: meta.color }} />
            {t(meta.text)}
          </span>
        );
      },
    },
    {
      title: t('user.lastLogin'),
      dataIndex: 'lastLoginAt',
      width: 170,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : <span className="cell-muted">{t('user.neverLogin')}</span>,
    },
    {
      title: t('common.operation'),
      width: 132,
      fixed: 'right',
      render: (_, record) => (
        <Space size={0} className="user-actions">
          {hasPerm('system:user:edit') && (
            <Tooltip title={t('common.edit')}>
              <Button type="text" size="small" className="action-btn" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
            </Tooltip>
          )}
          {hasPerm('system:user:resetpwd') && (
            <Tooltip title={t('user.resetPwd')}>
              <Button type="text" size="small" className="action-btn" icon={<KeyOutlined />} onClick={() => handleResetPwd(record)} />
            </Tooltip>
          )}
          {hasPerm('system:user:delete') && (
            <Popconfirm title={t('user.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
              <Tooltip title={t('common.delete')}>
                <Button type="text" size="small" className="action-btn action-danger" icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, hasPerm]);

  const canCreate = hasPerm('system:user:create');

  return (
    <div className="user-management">
      <div className="um-page-head">
        <div>
          <h2 className="um-title">{t('user.title')}</h2>
          <p className="um-subtitle">{t('user.pageDesc')}</p>
        </div>
        {canCreate && (
          <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={handleAdd} className="um-add-btn">
            {t('user.addTitle')}
          </Button>
        )}
      </div>

      <div className="um-toolbar">
        <Input
          className="um-search"
          placeholder={t('user.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => { setPage(1); fetchUsers(); }}
          allowClear
        />
        <Segmented
          className="um-status-filter"
          options={statusOptions}
          value={statusFilter}
          onChange={(v) => { setStatusFilter(v as string); setPage(1); }}
        />
        <div className="um-toolbar-spacer" />
        <Tooltip title={t('common.refresh')}>
          <Button className="um-refresh" icon={<ReloadOutlined />} onClick={fetchUsers} />
        </Tooltip>
      </div>

      <div className="um-card">
        <div className="um-card-head">
          <div className="um-card-head-left">
            <span className="um-card-title">{t('user.listTitle')}</span>
            <span className="um-count">{total}</span>
          </div>
          <div className="um-stat-pills">
            <span className="um-stat-pill um-stat-active"><i />{users.filter(u => u.status === 'ACTIVE').length} {t('user.statusActive')}</span>
            <span className="um-stat-pill um-stat-disabled"><i />{users.filter(u => u.status === 'DISABLED').length} {t('user.statusDisabled')}</span>
          </div>
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={users}
          loading={loading}
          scroll={{ x: 1080 }}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('user.empty')} /> }}
          rowClassName={() => 'um-row'}
        />
      </div>

      {total > pageSize && (
        <div className="um-pagination">
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

      <ResetPasswordModal
        open={resetOpen}
        targetUser={resetTarget}
        onClose={handleResetClose}
        onSuccess={fetchUsers}
        api={userApi}
        t={t}
      />
    </div>
  );
}
