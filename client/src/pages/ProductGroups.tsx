import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Button, Table, Tag, Space, Modal, Form, Input, Select, App, Popconfirm, Divider, Typography, Row, Col,
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ExperimentOutlined, FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { productGroupApi, ProductGroup, productApi, Product } from '../api/products';
import { sampleApi } from '../api/products';
import { quoteApi } from '../api/products';

const { Text } = Typography;

const STATUS_COLOR: Record<string, string> = { DRAFT: 'default', SUBMITTED: 'blue', APPROVED: 'green', REJECTED: 'red', PENDING: 'gold', DONE: 'green' };
const STATUS_LABEL: Record<string, string> = { DRAFT: '草稿', SUBMITTED: '已提交', APPROVED: '已通过', REJECTED: '已驳回', PENDING: '待处理', DONE: '已完成' };

export default function ProductGroups() {
  const { message } = App.useApp();
  const [list, setList] = useState<ProductGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [loading, setLoading] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProductGroup | null>(null);
  const [form] = Form.useForm();

  // 成员管理弹窗
  const [memberOpen, setMemberOpen] = useState(false);
  const [currentGroup, setCurrentGroup] = useState<ProductGroup | null>(null);
  const [memberSelected, setMemberSelected] = useState<string[]>([]);

  // 打样/报价弹窗
  const [sampleOpen, setSampleOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [submitTarget, setSubmitTarget] = useState<ProductGroup | null>(null);
  const [sampleForm] = Form.useForm();
  const [quoteForm] = Form.useForm();

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productGroupApi.getList({ page, pageSize });
      const d = res.data?.data;
      if (d) {
        setList(d.list);
        setTotal(d.total);
      }
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchProducts = async () => {
    try {
      const res = await productApi.getList({ page: 1, pageSize: 200 });
      const d = res.data?.data;
      if (d) setProducts(d.list);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchProducts(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ productIds: [] });
    setOpen(true);
  };

  const openEdit = (g: ProductGroup) => {
    setEditing(g);
    form.setFieldsValue({ name: g.name, description: g.description ?? '', productIds: (g.productIds || '').split(',').filter(Boolean) });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await productGroupApi.update(editing.id, values);
        message.success('已更新产品组');
      } else {
        await productGroupApi.create(values);
        message.success('已创建产品组');
      }
      setOpen(false);
      fetchGroups();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    }
  };

  const remove = async (id: string) => {
    try {
      await productGroupApi.remove(id);
      message.success('已删除');
      fetchGroups();
    } catch {
      message.error('删除失败');
    }
  };

  const openMembers = (g: ProductGroup) => {
    setCurrentGroup(g);
    setMemberSelected((g.productIds || '').split(',').filter(Boolean));
    setMemberOpen(true);
  };

  const saveMembers = async () => {
    if (!currentGroup) return;
    try {
      // 用 add/remove 增量更新：先移除全部再添加当前选择
      const current = (currentGroup.productIds || '').split(',').filter(Boolean);
      const toRemove = current.filter((id) => !memberSelected.includes(id));
      const toAdd = memberSelected.filter((id) => !current.includes(id));
      if (toRemove.length) await productGroupApi.updateProducts(currentGroup.id, toRemove, 'remove');
      if (toAdd.length) await productGroupApi.updateProducts(currentGroup.id, toAdd, 'add');
      message.success('成员已更新');
      setMemberOpen(false);
      fetchGroups();
    } catch {
      message.error('更新成员失败');
    }
  };

  const openSample = (g: ProductGroup) => {
    setSubmitTarget(g);
    sampleForm.resetFields();
    setSampleOpen(true);
  };
  const openQuote = (g: ProductGroup) => {
    setSubmitTarget(g);
    quoteForm.resetFields();
    quoteForm.setFieldsValue({ title: `${g.name} 报价单` });
    setQuoteOpen(true);
  };

  const submitSample = async () => {
    if (!submitTarget) return;
    const values = await sampleForm.validateFields();
    try {
      await sampleApi.apply({ targetType: 'GROUP', targetId: submitTarget.id, remark: values.remark });
      message.success('打样申请已提交');
      setSampleOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '提交失败');
    }
  };

  const submitQuote = async () => {
    if (!submitTarget) return;
    const values = await quoteForm.validateFields();
    try {
      await quoteApi.create({ targetType: 'GROUP', targetId: submitTarget.id, title: values.title, remark: values.remark, items: values.items });
      message.success('报价单已创建');
      setQuoteOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建失败');
    }
  };

  const columns = [
    { title: '产品组名称', dataIndex: 'name', render: (v: string, r: ProductGroup) => <Space>{v}{r.description && <Text type="secondary">（{r.description}）</Text>}</Space> },
    {
      title: '成员产品', key: 'members',
      render: (_: any, r: ProductGroup) => (
        <Space wrap>
          <Tag color="blue">{(r.productIds || '').split(',').filter(Boolean).length} 个</Tag>
          {(r.products || []).slice(0, 3).map((p) => (
            <Tag key={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</Tag>
          ))}
          {((r.products || []).length > 3) && <Tag>+{ (r.products || []).length - 3 }</Tag>}
        </Space>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (v: string) => new Date(v).toLocaleString() },
    {
      title: '操作', key: 'action', width: 320,
      render: (_: any, r: ProductGroup) => (
        <Space size={4} wrap>
          <Button size="small" icon={<TeamOutlined />} onClick={() => openMembers(r)}>管理成员</Button>
          <Button size="small" icon={<ExperimentOutlined />} onClick={() => openSample(r)}>申请打样</Button>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => openQuote(r)}>创建报价</Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="删除该产品组？" onConfirm={() => remove(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card
        title="产品组"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建产品组</Button>}
        styles={{ body: { padding: 16 } }}
      >
        <Table rowKey="id" loading={loading} columns={columns as any} dataSource={list} pagination={{ current: page, pageSize, total, onChange: setPage }} />
      </Card>

      {/* 新建 / 编辑 */}
      <Modal title={editing ? '编辑产品组' : '新建产品组'} open={open} onCancel={() => setOpen(false)} onOk={submit} width={640} okText="保存">
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="产品组名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如 2024春季毛绒新品组" />
          </Form.Item>
          <Form.Item name="description" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="productIds" label="成员产品">
            <Select
              mode="multiple"
              showSearch
              optionFilterProp="label"
              placeholder="选择产品"
              options={products.map((p) => ({ label: `${p.name}${p.sku ? `（${p.sku}）` : ''}`, value: p.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 成员管理 */}
      <Modal title={`管理成员 - ${currentGroup?.name || ''}`} open={memberOpen} onCancel={() => setMemberOpen(false)} onOk={saveMembers} width={640} okText="保存">
        <Text type="secondary">勾选加入产品组，取消勾选则移出（一产品一 SKU，独立计量）。</Text>
        <Divider style={{ margin: '12px 0' }} />
        <Select
          style={{ width: '100%' }}
          mode="multiple"
          showSearch
          optionFilterProp="label"
          placeholder="选择产品"
          value={memberSelected}
          onChange={setMemberSelected}
          options={products.map((p) => ({ label: `${p.name}${p.sku ? `（${p.sku}）` : ''}`, value: p.id }))}
        />
      </Modal>

      {/* 申请打样 */}
      <Modal title={`申请打样 - ${submitTarget?.name || ''}`} open={sampleOpen} onCancel={() => setSampleOpen(false)} onOk={submitSample} okText="提交申请">
        <Form form={sampleForm} layout="vertical">
          <Form.Item name="remark" label="打样说明">
            <Input.TextArea rows={4} placeholder="如 需要 3 件手板，颜色红色" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建报价 */}
      <Modal title={`创建报价单 - ${submitTarget?.name || ''}`} open={quoteOpen} onCancel={() => setQuoteOpen(false)} onOk={submitQuote} okText="创建">
        <Form form={quoteForm} layout="vertical">
          <Form.Item name="title" label="报价单标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="items" label="报价明细（JSON，可选）">
            <Input.TextArea rows={4} placeholder='[{"productId":"...","price":10}]' />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
