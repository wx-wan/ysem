import { useEffect, useState, useMemo } from 'react';
import { Table, Button, Space, Tag, App, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import DeptFormModal from '../components/dept/DeptFormModal';

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

export default function DeptPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [depts, setDepts] = useState<DeptRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DeptRecord | null>(null);
  const [parentId, setParentId] = useState<string | undefined>(undefined);

  const fetchDepts = async () => {
    setLoading(true);
    try {
      const res = await request.get('/departments');
      setDepts(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDepts(); }, []);

  const handleAdd = (pid?: string) => {
    setEditingDept(null);
    setParentId(pid);
    setModalOpen(true);
  };

  const handleEdit = (record: DeptRecord) => {
    setEditingDept(record);
    setParentId(undefined);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/departments/${id}`);
      message.success(t('dept.deleteSuccess'));
      fetchDepts();
    } catch { /* handled */ }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingDept(null);
    setParentId(undefined);
  };

  const columns: ColumnsType<DeptRecord> = useMemo(() => [
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
          <Button type="link" size="small" onClick={() => handleAdd(record.id)}>{t('dept.addChild')}</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Popconfirm title={t('dept.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ], [t]);

  const parentDeptOptions = useMemo(() => depts.map((d) => ({ label: d.name, value: d.id })), [depts]);

  return (
    <>
      <div className="page-header"><h2>{t('dept.title')}</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchDepts}>{t('common.refresh')}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>{t('dept.addTitle')}</Button>
      </div>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={depts}
          loading={loading}
          pagination={false}
          defaultExpandAllRows
        />
      </div>

      <DeptFormModal
        open={modalOpen}
        editingDept={editingDept}
        parentOptions={parentDeptOptions}
        onClose={handleModalClose}
        onSuccess={fetchDepts}
        api={deptApi}
        t={t}
        initialParentId={parentId}
      />
    </>
  );
}
