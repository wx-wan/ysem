import { useEffect, useState, useMemo } from 'react';
import { Table, Button, Space, Tag, App, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SafetyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import RoleFormModal from '../components/role/RoleFormModal';
import RolePermModal from '../components/role/RolePermModal';

interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
  _count: { users: number };
}

const roleApi = {
  create: (data: any) => request.post('/roles', data),
  update: (id: string, data: any) => request.put(`/roles/${id}`, data),
};

const permApi = {
  getPermissions: () => request.get('/permissions/tree'),
  getRole: (id: string) => request.get(`/roles/${id}`),
  assign: (roleId: string, permissionIds: string[]) =>
    request.post(`/roles/${roleId}/permissions`, { permissionIds }),
};

export default function RolePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [permModalOpen, setPermModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string>('');

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
    setModalOpen(true);
  };

  const handleEdit = (record: RoleRecord) => {
    setEditingRole(record);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/roles/${id}`);
      message.success(t('role.deleteSuccess'));
      fetchRoles();
    } catch { /* handled */ }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingRole(null);
  };

  const openPermModal = (role: RoleRecord) => {
    setCurrentRoleId(role.id);
    setPermModalOpen(true);
  };

  const handlePermClose = () => {
    setPermModalOpen(false);
    setCurrentRoleId('');
  };

  const columns: ColumnsType<RoleRecord> = useMemo(() => [
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
  ], [t]);

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

      <RoleFormModal
        open={modalOpen}
        editingRole={editingRole}
        onClose={handleModalClose}
        onSuccess={fetchRoles}
        api={roleApi}
        t={t}
      />
      <RolePermModal
        open={permModalOpen}
        roleId={currentRoleId}
        onClose={handlePermClose}
        onSuccess={fetchRoles}
        api={permApi}
        t={t}
      />
    </>
  );
}
