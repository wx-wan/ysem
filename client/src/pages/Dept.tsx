import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';

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

export default function DeptPage() {
  const { t } = useTranslation();
  const [depts, setDepts] = useState<DeptRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDept, setEditingDept] = useState<DeptRecord | null>(null);
  const [form] = Form.useForm();

  const fetchDepts = async () => {
    setLoading(true);
    try {
      const res = await request.get('/departments');
      setDepts(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchDepts(); }, []);

  const handleAdd = (parentId?: string) => {
    setEditingDept(null);
    form.resetFields();
    if (parentId) form.setFieldValue('parentId', parentId);
    setModalOpen(true);
  };

  const handleEdit = (record: DeptRecord) => {
    setEditingDept(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/departments/${id}`);
      message.success(t('dept.deleteSuccess'));
      fetchDepts();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingDept) {
        await request.put(`/departments/${editingDept.id}`, values);
        message.success(t('dept.updateSuccess'));
      } else {
        await request.post('/departments', values);
        message.success(t('dept.createSuccess'));
      }
      setModalOpen(false);
      fetchDepts();
    } catch { /* handled */ }
  };

  const columns: ColumnsType<DeptRecord> = [
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
  ];

  const parentDeptOptions = depts.map((d) => ({ label: d.name, value: d.id }));

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

      <Modal
        title={editingDept ? t('dept.editTitle') : t('dept.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label={t('dept.name')} rules={[{ required: true, message: t('dept.nameRequired') }]}>
            <Input placeholder={t('dept.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="code" label={t('dept.code')} rules={[{ required: true, message: t('dept.codeRequired') }]}>
            <Input placeholder={t('dept.codePlaceholder')} disabled={!!editingDept} />
          </Form.Item>
          <Form.Item name="parentId" label={t('dept.parentDept')}>
            <Select placeholder={t('dept.parentPlaceholder')} allowClear options={parentDeptOptions} />
          </Form.Item>
          <Form.Item name="leader" label={t('dept.leader')}>
            <Input placeholder={t('dept.leaderPlaceholder')} />
          </Form.Item>
          <Form.Item name="phone" label={t('dept.phone')}>
            <Input placeholder={t('dept.phonePlaceholder')} />
          </Form.Item>
          <Form.Item name="email" label={t('dept.email')}>
            <Input placeholder={t('dept.emailPlaceholder')} />
          </Form.Item>
          <Form.Item name="sort" label={t('dept.sort')}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="status" label={t('dept.status')}>
            <Select>
              <Select.Option value={1}>{t('dept.statusEnabled')}</Select.Option>
              <Select.Option value={0}>{t('dept.statusDisabled')}</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
