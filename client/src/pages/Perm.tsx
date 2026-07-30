import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';

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

export default function PermPage() {
  const { t } = useTranslation();
  const [permissions, setPermissions] = useState<PermRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<PermRecord | null>(null);
  const [form] = Form.useForm();

  const fetchPerms = async () => {
    setLoading(true);
    try {
      const res = await request.get('/permissions');
      setPermissions(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPerms(); }, []);

  const handleAdd = (parentId?: string) => {
    setEditingPerm(null);
    form.resetFields();
    if (parentId) {
      form.setFieldValue('parentId', parentId);
      form.setFieldValue('type', 'BUTTON');
    } else {
      form.setFieldValue('type', 'MENU');
    }
    setModalOpen(true);
  };

  const handleEdit = (record: PermRecord) => {
    setEditingPerm(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/permissions/${id}`);
      message.success(t('perm.deleteSuccess'));
      fetchPerms();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingPerm) {
        await request.put(`/permissions/${editingPerm.id}`, values);
        message.success(t('perm.updateSuccess'));
      } else {
        await request.post('/permissions', values);
        message.success(t('perm.createSuccess'));
      }
      setModalOpen(false);
      fetchPerms();
    } catch { /* handled */ }
  };

  const typeMap: Record<string, { color: string; text: string }> = {
    MENU: { color: 'blue', text: t('perm.typeMenu') },
    BUTTON: { color: 'green', text: t('perm.typeButton') },
    API: { color: 'orange', text: t('perm.typeApi') },
  };

  const columns: ColumnsType<PermRecord> = [
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
          <Button type="link" size="small" onClick={() => handleAdd(record.id)}>{t('perm.addChild')}</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>{t('common.edit')}</Button>
          <Popconfirm title={t('perm.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const parentOptions = permissions
    .filter((p) => p.type === 'MENU')
    .map((p) => ({ label: `${p.name} (${p.code})`, value: p.id }));

  return (
    <>
      <div className="page-header"><h2>{t('perm.title')}</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchPerms}>{t('common.refresh')}</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>{t('perm.addTitle')}</Button>
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

      <Modal
        title={editingPerm ? t('perm.editTitle') : t('perm.addTitle')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label={t('perm.name')} rules={[{ required: true, message: t('perm.nameRequired') }]}>
            <Input placeholder={t('perm.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="code" label={t('perm.code')} rules={[{ required: true, message: t('perm.codeRequired') }]}>
            <Input placeholder={t('perm.codePlaceholder')} disabled={!!editingPerm} />
          </Form.Item>
          <Form.Item name="type" label={t('perm.type')} rules={[{ required: true }]}>
            <Select>
              <Select.Option value="MENU">{t('perm.typeMenu')}</Select.Option>
              <Select.Option value="BUTTON">{t('perm.typeButton')}</Select.Option>
              <Select.Option value="API">{t('perm.typeApi')}</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="parentId" label={t('perm.parentMenu')}>
            <Select placeholder={t('perm.parentPlaceholder')} allowClear options={parentOptions} />
          </Form.Item>
          <Form.Item name="path" label={t('perm.path')}>
            <Input placeholder={t('perm.pathPlaceholder')} />
          </Form.Item>
          <Form.Item name="icon" label={t('perm.icon')}>
            <Input placeholder={t('perm.iconPlaceholder')} />
          </Form.Item>
          <Form.Item name="sort" label={t('perm.sort')}>
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
