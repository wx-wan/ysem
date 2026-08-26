import { useEffect, useState, useCallback, useMemo } from 'react';
import { Table, Button, Input, Space, Tag, App, Popconfirm, Pagination, Tooltip, Avatar, Empty } from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, KeyOutlined, UserOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import UserFormModal from '../components/user/UserFormModal';
import ResetPasswordModal from '../components/user/ResetPasswordModal';
import RoleFormModal from '../components/role/RoleFormModal';
import DeptFormModal from '../components/dept/DeptFormModal';
import { buildTablePagination } from '../components/common/tablePagination';
import SegmentedTabBar from '../components/common/SegmentedTabBar';
import { usePermission } from '../hooks/usePermission';

type TabKey = 'user' | 'role' | 'dept';

// ========== 用户 ==========
interface UserRecord {
  id: string;
  username: string;
  realName: string;
  email: string;
  phone: string;
  status: string;
  createdAt: string;
  lastLoginAt: string;
  avatar?: string | null;
  role: { id: string; name: string; code: string } | null;
  department: { id: string; name: string } | null;
}
interface RoleOption { id: string; name: string; }
interface DeptOption { id: string; name: string; }

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

// ========== 角色 ==========
interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
  dataScope?: string;
  _count: { users: number };
}

// 数据范围 → i18n key（与服务端 utils/scope.ts 保持一致）
const DATA_SCOPE_TEXT: Record<string, string> = {
  ALL: 'role.dataScopeAll',
  DEPT: 'role.dataScopeDept',
  SELF: 'role.dataScopeSelf',
};
const roleApi = {
  create: (data: any) => request.post('/roles', data),
  update: (id: string, data: any) => request.put(`/roles/${id}`, data),
};
const permApi = {
  getPermissions: () => request.get('/permissions/tree'),
  getRole: (id: string) => request.get(`/roles/${id}`),
  assign: (roleId: string, permissionIds: string[]) => request.post(`/roles/${roleId}/permissions`, { permissionIds }),
};

// ========== 部门 ==========
interface DeptRecord {
  id: string;
  name: string;
  code: string;
  leader: string;
  phone: string;
  email: string;
  sort: number;
  status: number;
  parentId: string | null;
  _count: { users: number };
  children?: DeptRecord[];
}
const deptApi = {
  create: (data: any) => request.post('/departments', data),
  update: (id: string, data: any) => request.put(`/departments/${id}`, data),
};

const TAB_OPTIONS: { label: string; key: TabKey }[] = [
  { label: '用户', key: 'user' },
  { label: '角色', key: 'role' },
  { label: '部门', key: 'dept' },
];

export default function UserManagementPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();
  const [tab, setTab] = useState<TabKey>(
    hasPerm('system:user') ? 'user' : hasPerm('system:role') ? 'role' : 'dept',
  );

  // ---------- 用户 state ----------
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userLoading, setUserLoading] = useState(true);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [userKeyword, setUserKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [depts, setDepts] = useState<DeptOption[]>([]);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRecord | null>(null);

  // ---------- 角色 state ----------
  const [rolesData, setRolesData] = useState<RoleRecord[]>([]);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);

  // ---------- 部门 state ----------
  const [deptsData, setDeptsData] = useState<DeptRecord[]>([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptModalOpen, setDeptModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DeptRecord | null>(null);
  const [deptParentId, setDeptParentId] = useState<string | undefined>(undefined);

  // ===== fetch =====
  const fetchUsers = useCallback(async () => {
    setUserLoading(true);
    try {
      const params: Record<string, string> = { page: String(userPage), pageSize: String(userPageSize), keyword: userKeyword };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await request.get('/users', { params });
      setUsers(res.data.data.list);
      setUserTotal(res.data.data.total);
    } catch { /* handled */ }
    finally { setUserLoading(false); }
  }, [userPage, userPageSize, userKeyword, statusFilter]);

  const fetchOptions = async () => {
    const [rolesRes, deptsRes] = await Promise.all([request.get('/roles'), request.get('/departments')]);
    setRoles(rolesRes.data.data || []);
    setDepts(deptsRes.data.data || []);
  };

  const fetchRoles = async () => {
    setRoleLoading(true);
    try { const res = await request.get('/roles'); setRolesData(res.data.data || []); }
    catch { /* handled */ }
    finally { setRoleLoading(false); }
  };

  const fetchDepts = async () => {
    setDeptLoading(true);
    try { const res = await request.get('/departments'); setDeptsData(res.data.data || []); }
    catch { /* handled */ }
    finally { setDeptLoading(false); }
  };

  // 切换 tab 时加载对应数据
  useEffect(() => {
    if (tab === 'user') fetchUsers();
    if (tab === 'role') fetchRoles();
    if (tab === 'dept') fetchDepts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { if (tab === 'user') fetchUsers(); }, [fetchUsers]);

  // ===== 用户操作 =====
  const handleAddUser = () => { setEditingUser(null); fetchOptions(); setUserModalOpen(true); };
  const handleEditUser = (r: UserRecord) => { setEditingUser(r); fetchOptions(); setUserModalOpen(true); };
  const handleDeleteUser = async (id: string) => {
    try { await request.delete(`/users/${id}`); message.success(t('user.deleteSuccess')); fetchUsers(); }
    catch { /* handled */ }
  };
  const handleResetPwd = (r: UserRecord) => { setResetTarget(r); setResetOpen(true); };

  // ===== 角色操作 =====
  const handleAddRole = () => { setEditingRole(null); setRoleModalOpen(true); };
  const handleEditRole = (r: RoleRecord) => { setEditingRole(r); setRoleModalOpen(true); };
  const handleDeleteRole = async (id: string) => {
    try { await request.delete(`/roles/${id}`); message.success(t('role.deleteSuccess')); fetchRoles(); }
    catch { /* handled */ }
  };

  // ===== 部门操作 =====
  const handleAddDept = (pid?: string) => { setEditingDept(null); setDeptParentId(pid); setDeptModalOpen(true); };
  const handleEditDept = (r: DeptRecord) => { setEditingDept(r); setDeptParentId(undefined); setDeptModalOpen(true); };
  const handleDeleteDept = async (id: string) => {
    try { await request.delete(`/departments/${id}`); message.success(t('dept.deleteSuccess')); fetchDepts(); }
    catch { /* handled */ }
  };

  // ===== 列定义 =====
  const userColumns: ColumnsType<UserRecord> = useMemo(() => [
    {
      title: t('user.username'), dataIndex: 'username', width: 220,
      render: (_: string, record) => (
        <div className="user-cell">
          <Avatar size={36} className="user-cell-avatar" src={record.avatar} icon={<UserOutlined />}>
            {(record.realName || record.username).slice(0, 1).toUpperCase()}
          </Avatar>
          <div className="user-cell-info">
            <span className="user-cell-name">{record.realName || record.username}</span>
            <span className="user-cell-sub">@{record.username}</span>
          </div>
        </div>
      ),
    },
    { title: t('user.email'), dataIndex: 'email', width: 200, render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span> },
    { title: t('user.phone'), dataIndex: 'phone', width: 140, render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span> },
    {
      title: t('user.role'), dataIndex: ['role', 'name'], width: 120,
      render: (v: string) => v ? <Tag className="role-tag">{v}</Tag> : <span className="cell-muted">{t('common.noData')}</span>,
    },
    {
      title: t('user.dept'), dataIndex: ['department', 'name'], width: 130,
      render: (v: string) => v || <span className="cell-muted">{t('common.noData')}</span>,
    },
    {
      title: t('user.status'), dataIndex: 'status', width: 100,
      render: (s: string) => {
        const meta = STATUS_META[s] || { color: '#94a3b8', bg: '#f1f5f9', text: s };
        return <span className="status-pill" style={{ color: meta.color, background: meta.bg }}><span className="status-dot" style={{ background: meta.color }} />{t(meta.text)}</span>;
      },
    },
    {
      title: t('user.lastLogin'), dataIndex: 'lastLoginAt', width: 170, ellipsis: true,
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : <span className="cell-muted">{t('user.neverLogin')}</span>,
    },
    {
      title: t('common.operation'), width: 150, fixed: 'right', className: 'um-op-cell',
      render: (_, record) => (
        <Space size={0} className="user-actions">
          {hasPerm('system:user:edit') && <Tooltip title={t('common.edit')}><Button type="text" size="small" className="action-btn" icon={<EditOutlined />} onClick={() => handleEditUser(record)} /></Tooltip>}
          {hasPerm('system:user:resetpwd') && <Tooltip title={t('user.resetPwd')}><Button type="text" size="small" className="action-btn" icon={<KeyOutlined />} onClick={() => handleResetPwd(record)} /></Tooltip>}
          {hasPerm('system:user:delete') && (
            <Popconfirm title={t('user.deleteConfirm')} onConfirm={() => handleDeleteUser(record.id)}>
              <Tooltip title={t('common.delete')}><Button type="text" size="small" className="action-btn action-danger" icon={<DeleteOutlined />} /></Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, hasPerm]);

  const roleColumns: ColumnsType<RoleRecord> = useMemo(() => [
    { title: t('role.name'), dataIndex: 'name', width: 150 },
    { title: t('role.code'), dataIndex: 'code', width: 120, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: t('role.description'), dataIndex: 'description', ellipsis: true },
    { title: t('role.sort'), dataIndex: 'sort', width: 80 },
    {
      title: t('role.dataScope'), dataIndex: 'dataScope', width: 130,
      render: (v: string) => <Tag color="cyan">{t(DATA_SCOPE_TEXT[v] || 'role.dataScopeSelf')}</Tag>,
    },
    { title: t('role.userCount'), dataIndex: ['_count', 'users'], width: 80 },
    {
      title: t('common.operation'), width: 220, fixed: 'right',
      render: (_, record) => (
        <Space>
          {hasPerm('system:role:edit') && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditRole(record)}>{t('common.edit')}</Button>}
          {hasPerm('system:role:delete') && (
            <Popconfirm title={t('role.deleteConfirm')} onConfirm={() => handleDeleteRole(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, hasPerm]);

  const deptColumns: ColumnsType<DeptRecord> = useMemo(() => [
    { title: t('dept.name'), dataIndex: 'name', width: 180 },
    { title: t('dept.code'), dataIndex: 'code', width: 120, render: (v: string) => <Tag color="purple">{v}</Tag> },
    { title: t('dept.leader'), dataIndex: 'leader', width: 100, render: (v: string) => v || t('common.noData') },
    { title: t('dept.phone'), dataIndex: 'phone', width: 130, render: (v: string) => v || t('common.noData') },
    { title: t('dept.sort'), dataIndex: 'sort', width: 80 },
    {
      title: t('dept.status'), dataIndex: 'status', width: 80,
      render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? t('dept.statusEnabled') : t('dept.statusDisabled')}</Tag>,
    },
    { title: t('dept.userCount'), dataIndex: ['_count', 'users'], width: 80 },
    {
      title: t('common.operation'), width: 200, fixed: 'right',
      render: (_, record) => (
        <Space>
          {hasPerm('system:dept:create') && <Button type="link" size="small" onClick={() => handleAddDept(record.id)}>{t('dept.addChild')}</Button>}
          {hasPerm('system:dept:edit') && <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEditDept(record)}>{t('common.edit')}</Button>}
          {hasPerm('system:dept:delete') && (
            <Popconfirm title={t('dept.deleteConfirm')} onConfirm={() => handleDeleteDept(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, hasPerm]);

  const statusOptions = useMemo(() => [
    { label: t('common.all'), key: 'ALL' },
    { label: t('user.statusActive'), key: 'ACTIVE' },
    { label: t('user.statusDisabled'), key: 'DISABLED' },
    { label: t('user.statusLocked'), key: 'LOCKED' },
  ], [t]);

  const parentDeptOptions = useMemo(() => deptsData.map((d) => ({ label: d.name, value: d.id })), [deptsData]);

  return (
    <div className="user-management">
      <div className="um-page-head">
        <div>
          <h2 className="um-title">{t('user.title')}</h2>
          <p className="um-subtitle">{t('user.pageDesc')}</p>
        </div>
      </div>

      <SegmentedTabBar options={TAB_OPTIONS} value={tab} onChange={(v) => setTab(v as TabKey)} />

      {/* ===== 用户 Tab ===== */}
      {tab === 'user' && (
        <>
          <div className="um-toolbar">
            <Input
              className="um-search"
              placeholder={t('user.searchPlaceholder')}
              prefix={<SearchOutlined />}
              value={userKeyword}
              onChange={(e) => setUserKeyword(e.target.value)}
              onKeyDown={(e) => { if (e.key && e.key.toLowerCase() === 'enter') { e.preventDefault(); setUserPage(1); fetchUsers(); } }}
              allowClear
            />
            <SegmentedTabBar options={statusOptions} value={statusFilter} onChange={(v) => { setStatusFilter(v as string); setUserPage(1); }} />
            <div className="um-toolbar-spacer" />
            <Tooltip title={t('common.refresh')}><Button className="um-refresh" icon={<ReloadOutlined />} onClick={fetchUsers} /></Tooltip>
            {hasPerm('system:user:create') && (
              <Button type="primary" size="middle" icon={<PlusOutlined />} onClick={handleAddUser} className="um-add-btn">{t('user.addTitle')}</Button>
            )}
          </div>
          <div className="um-card">
            <div className="um-card-head">
              <div className="um-card-head-left">
                <span className="um-card-title">{t('user.listTitle')}</span>
                <span className="um-count">{userTotal}</span>
              </div>
              <div className="um-stat-pills">
                <span className="um-stat-pill um-stat-active"><i />{users.filter(u => u.status === 'ACTIVE').length} {t('user.statusActive')}</span>
                <span className="um-stat-pill um-stat-disabled"><i />{users.filter(u => u.status === 'DISABLED').length} {t('user.statusDisabled')}</span>
              </div>
            </div>
            <Table
              rowKey="id" columns={userColumns} dataSource={users} loading={userLoading}
              scroll={{ x: 1300 }} pagination={false}
              locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('user.empty')} /> }}
            />
          </div>
          {userTotal > userPageSize && (
            <div className="um-pagination">
              <Pagination {...buildTablePagination({ total: userTotal, page: userPage, pageSize: userPageSize, onChange: (p, ps) => { setUserPage(p); setUserPageSize(ps); } })} />
            </div>
          )}
        </>
      )}

      {/* ===== 角色 Tab ===== */}
      {tab === 'role' && (
        <>
          <div className="search-bar" style={{ marginTop: 16 }}>
            <Button icon={<ReloadOutlined />} onClick={fetchRoles}>{t('common.refresh')}</Button>
            {hasPerm('system:role:create') && <Button type="primary" icon={<PlusOutlined />} onClick={handleAddRole}>{t('role.addTitle')}</Button>}
          </div>
          <div className="table-container">
            <Table rowKey="id" columns={roleColumns} dataSource={rolesData} loading={roleLoading} pagination={false} />
          </div>
        </>
      )}

      {/* ===== 部门 Tab ===== */}
      {tab === 'dept' && (
        <>
          <div className="search-bar" style={{ marginTop: 16 }}>
            <Button icon={<ReloadOutlined />} onClick={fetchDepts}>{t('common.refresh')}</Button>
            {hasPerm('system:dept:create') && <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAddDept()}>{t('dept.addTitle')}</Button>}
          </div>
          <div className="table-container">
            <Table rowKey="id" columns={deptColumns} dataSource={deptsData} loading={deptLoading} pagination={false} defaultExpandAllRows />
          </div>
        </>
      )}

      {/* 用户弹窗 */}
      <UserFormModal open={userModalOpen} editingUser={editingUser} roles={roles} depts={depts} onClose={() => { setUserModalOpen(false); setEditingUser(null); }} onSuccess={fetchUsers} api={userApi} t={t} />
      <ResetPasswordModal open={resetOpen} targetUser={resetTarget} onClose={() => { setResetOpen(false); setResetTarget(null); }} onSuccess={fetchUsers} api={userApi} t={t} />

      {/* 角色弹窗 */}
      <RoleFormModal
        open={roleModalOpen}
        editingRole={editingRole}
        viewRole={null}
        onClose={() => { setRoleModalOpen(false); setEditingRole(null); }}
        onSuccess={fetchRoles}
        roleApi={roleApi}
        permApi={permApi}
        t={t}
      />

      {/* 部门弹窗 */}
      <DeptFormModal open={deptModalOpen} editingDept={editingDept} parentOptions={parentDeptOptions} onClose={() => { setDeptModalOpen(false); setEditingDept(null); setDeptParentId(undefined); }} onSuccess={fetchDepts} api={deptApi} t={t} initialParentId={deptParentId} />
    </div>
  );
}
