import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
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
      message.success('删除成功');
      fetchDepts();
    } catch { /* handled */ }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingDept) {
        await request.put(`/departments/${editingDept.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/departments', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchDepts();
    } catch { /* handled */ }
  };

  const columns: ColumnsType<DeptRecord> = [
    { title: '部门名称', dataIndex: 'name', width: 180 },
    { title: '部门编码', dataIndex: 'code', width: 120, render: (v: string) => <Tag color="purple">{v}</Tag> },
    { title: '负责人', dataIndex: 'leader', width: 100, render: (v: string) => v || '-' },
    { title: '电话', dataIndex: 'phone', width: 130, render: (v: string) => v || '-' },
    { title: '排序', dataIndex: 'sort', width: 80 },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (s: number) => <Tag color={s === 1 ? 'green' : 'red'}>{s === 1 ? '启用' : '禁用'}</Tag>,
    },
    { title: '用户数', dataIndex: ['_count', 'users'], width: 80 },
    {
      title: '操作', width: 200, fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleAdd(record.id)}>添加子部门</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该部门吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const parentDeptOptions = depts.map((d) => ({ label: d.name, value: d.id }));

  return (
    <>
      <div className="page-header"><h2>部门管理</h2></div>
      <div className="search-bar">
        <Button icon={<ReloadOutlined />} onClick={fetchDepts}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>新增部门</Button>
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
        title={editingDept ? '编辑部门' : '新增部门'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="部门名称" rules={[{ required: true }]}>
            <Input placeholder="请输入部门名称" />
          </Form.Item>
          <Form.Item name="code" label="部门编码" rules={[{ required: true }]}>
            <Input placeholder="请输入部门编码" disabled={!!editingDept} />
          </Form.Item>
          <Form.Item name="parentId" label="上级部门">
            <Select placeholder="请选择上级部门（留空为顶级部门）" allowClear options={parentDeptOptions} />
          </Form.Item>
          <Form.Item name="leader" label="负责人">
            <Input placeholder="请输入负责人" />
          </Form.Item>
          <Form.Item name="phone" label="联系电话">
            <Input placeholder="请输入联系电话" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="请输入邮箱" />
          </Form.Item>
          <Form.Item name="sort" label="排序">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select>
              <Select.Option value={1}>启用</Select.Option>
              <Select.Option value={0}>禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
