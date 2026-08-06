import { useEffect, useState, useMemo } from 'react';
import { Table, Button, Space, Tag, App, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import PermFormModal from '../components/perm/PermFormModal';
import { usePermission } from '../hooks/usePermission';

interface PermRecord {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId: string | null;
  sort: number;
  path: string;
  icon: string;
}

const permApi = {
  create: (data: any) => request.post('/permissions', data),
  update: (id: string, data: any) => request.put(`/permissions/${id}`, data),
};

export default function PermPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();
  const [permissions, setPermissions] = useState<PermRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<PermRecord | null>(null);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [defaultType, setDefaultType] = useState<string>('MENU');

  const fetchPerms = async () => {
    setLoading(true);
    try {
      const res = await request.get('/permissions');
      setPermissions(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPerms(); }, []);

  const handleAdd = (pid?: string) => {
    setEditingPerm(null);
    setParentId(pid);
    setDefaultType(pid ? 'BUTTON' : 'MENU');
    setModalOpen(true);
  };

  const handleEdit = (record: PermRecord) => {
    setEditingPerm(record);
    setParentId(undefined);
    setDefaultType('MENU');
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/permissions/${id}`);
      message.success(t('perm.deleteSuccess'));
      fetchPerms();
    } catch { /* handled */ }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingPerm(null);
    setParentId(undefined);
  };

  const typeMap = useMemo<Record<string, { color: string; text: string }>>(() => ({
    MENU: { color: 'blue', text: t('perm.typeMenu') },
    BUTTON: { color: 'green', text: t('perm.typeButton') },
    API: { color: 'orange', text: t('perm.typeApi') },
  }), [t]);

  const columns: ColumnsType<PermRecord> = useMemo(() => [
    { title: t('perm.name'), dataIndex: 'name', width: 160 },
    { title: t('perm.code'), dataIndex: 'code', width: 200 },
    {
      title: t('perm.type'), dataIndex: 'type', width: 80,
      render: (tp: string) => {
        const info = typeMap[tp] || { color: 'default', text: tp };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: t('perm.path'), dataIndex: 'path', width: 180, render: (v: string) => v || t('common.noData') },
    { title: t('perm.icon'), dataIndex: 'icon', width: 160, render: (v: string) => v || t('common.noData') },
    { title: t('perm.sort'), dataIndex: 'sort', width: 70 },
    {
      title: t('common.operation'), width: 200, fixed: 'right',
      render: (_, record) => (
        <Space>
          {hasPerm('system:perm:edit') && (
            <Button type="link" size="small" onClick={() => handleAdd(record.id)}>{t('perm.addChild')}</Button>
          )}
          {hasPerm('system:perm:edit') && (
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          )}
          {hasPerm('system:perm:delete') && (
            <Popconfirm title={t('perm.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, typeMap, hasPerm]);

  const parentOptions = useMemo(() => permissions
    .filter((p) => p.type === 'MENU')
    .map((p) => ({ label: `${p.name} (${p.code})`, value: p.id })), [permissions]);

  return (
    <>
      <div className="page-header"><h2>{t('perm.title')}</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchPerms}>{t('common.refresh')}</Button>
        {hasPerm('system:perm:create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>{t('perm.addTitle')}</Button>
        )}
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={permissions}
          loading={loading}
          pagination={false}
          defaultExpandAllRows
        />
      </div>

      <PermFormModal
        open={modalOpen}
        editingPerm={editingPerm}
        parentOptions={parentOptions}
        onClose={handleModalClose}
        onSuccess={fetchPerms}
        api={permApi}
        t={t}
        initialParentId={parentId}
        initialType={defaultType}
      />
    </>
  );
}
