import { useEffect, useState } from 'react';
import { List, Avatar, Button, Space, Popconfirm, App, Empty, Typography } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, EyeOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import RoleFormModal from '../components/role/RoleFormModal';
import { usePermission } from '../hooks/usePermission';

interface UserBrief {
  id: string;
  realName: string;
  avatar: string | null;
}

interface RoleRecord {
  id: string;
  name: string;
  code: string;
  description: string;
  sort: number;
  _count: { users: number };
  users: UserBrief[];
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
  const { hasPerm } = usePermission();
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRecord | null>(null);
  const [viewRole, setViewRole] = useState<RoleRecord | null>(null);

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
    setViewRole(null);
    setModalOpen(true);
  };

  const handleEdit = (record: RoleRecord) => {
    setEditingRole(record);
    setViewRole(null);
    setModalOpen(true);
  };

  const handleView = (record: RoleRecord) => {
    setViewRole(record);
    setEditingRole(null);
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
    setViewRole(null);
  };

  const isAdminRole = (code: string) => code === 'admin';

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{t('role.title')}</h2>
        {hasPerm('system:role:create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            {t('role.addTitle')}
          </Button>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <List
          loading={loading}
          dataSource={roles}
          locale={{ emptyText: <Empty description={t('common.empty')} /> }}
          renderItem={(item) => (
            <List.Item
              style={{
                padding: '16px 24px',
                borderBottom: '1px solid #f0f0f0',
                background: '#fff',
              }}
              actions={[
                <Space key="ops" size={16}>
                  {isAdminRole(item.code) ? (
                    <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(item)}>
                      {t('role.view')}
                    </Button>
                  ) : (
                    <>
                      {hasPerm('system:role:edit') && (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(item)}>
                          {t('common.edit')}
                        </Button>
                      )}
                      {hasPerm('system:role:delete') && (
                        <Popconfirm title={t('role.deleteConfirm')} onConfirm={() => handleDelete(item.id)}>
                          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                            {t('common.delete')}
                          </Button>
                        </Popconfirm>
                      )}
                    </>
                  )}
                </Space>,
              ]}
            >
              <List.Item.Meta
                title={<Typography.Text strong>{item.name}</Typography.Text>}
                description={item.description || undefined}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' }}>
                {item.users.length > 0 ? (
                  <>
                    <Avatar.Group maxCount={4} size="small">
                      {item.users.map((u) => (
                        <Avatar key={u.id} src={u.avatar}>
                          {u.realName?.charAt(0)}
                        </Avatar>
                      ))}
                    </Avatar.Group>
                    <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                      {t('role.totalMembers', { count: item._count.users })}
                    </Typography.Text>
                    <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}>
                      {t('role.editMembers')}
                    </Button>
                  </>
                ) : (
                  <Button type="link" size="small" style={{ padding: 0, fontSize: 13 }}>
                    {t('role.addMember')}
                  </Button>
                )}
              </div>
            </List.Item>
          )}
        />
      </div>

      <RoleFormModal
        open={modalOpen}
        editingRole={editingRole}
        viewRole={viewRole}
        onClose={handleModalClose}
        onSuccess={fetchRoles}
        roleApi={roleApi}
        permApi={permApi}
        t={t}
      />
    </>
  );
}
