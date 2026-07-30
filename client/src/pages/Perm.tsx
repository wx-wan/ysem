import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
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
      message.success('删除成功');
      fetchPerms();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingPerm) {
        await request.put(`/permissions/${editingPerm.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/permissions', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchPerms();
    } catch { /* handled */ }
  };

  const typeMap: Record<string, { color: string; text: string }> = {
    MENU: { color: 'blue', text: '菜单' },
    BUTTON: { color: 'green', text: '按钮' },
    API: { color: 'orange', text: '接口' },
  };

  const columns: ColumnsType<PermRecord> = [
    { title: '权限名称', dataIndex: 'name', width: 160 },
    { title: '权限编码', dataIndex: 'code', width: 200 },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (t: string) => {
        const info = typeMap[t] || { color: 'default', text: t };
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    { title: '路由路径', dataIndex: 'path', width: 180, render: (v: string) => v || '-' },
    { title: '图标', dataIndex: 'icon', width: 160, render: (v: string) => v || '-' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '操作', width: 200, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleAdd(record.id)}>添加子级</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该权限吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
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
      <div className="page-header"><h2>权限管理</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchPerms}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>新增权限</Button>
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
        title={editingPerm ? '编辑权限' : '新增权限'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="权限名称" rules={[{ required: true }]}>
            <Input placeholder="请输入权限名称" />
          </Form.Item>
          <Form.Item name="code" label="权限编码" rules={[{ required: true }]}>
            <Input placeholder="请输入权限编码（如 system:user:create）" disabled={!!editingPerm} />
          </Form.Item>
          <Form.Item name="type" label="权限类型" rules={[{ required: true }]}>
            <Select>
              <Select.Option value="MENU">菜单</Select.Option>
              <Select.Option value="BUTTON">按钮</Select.Option>
              <Select.Option value="API">接口</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="parentId" label="上级菜单">
            <Select placeholder="请选择上级菜单" allowClear options={parentOptions} />
          </Form.Item>
          <Form.Item name="path" label="路由路径">
            <Input placeholder="如 /system/user" />
          </Form.Item>
          <Form.Item name="icon" label="图标">
            <Input placeholder="如 UserOutlined" />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
