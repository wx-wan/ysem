import React, { useEffect, useState, useCallback } from 'react';
import {
  Button, Space, Modal, Form, Input, Select, App, Popconfirm, Divider, Typography,
} from 'antd';
import { EditOutlined, DeleteOutlined, ExperimentOutlined, FileTextOutlined, TeamOutlined } from '@ant-design/icons';
import { productGroupApi, ProductGroup, productApi, Product } from '../../api/products';
import { sampleApi, quoteApi } from '../../api/products';

const { Text } = Typography;

interface Props {
  groupId: string | null;
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

/** 单个产品组的集中管理：成员、编辑、打样、报价、删除。供混合列表中的组合卡片调用。 */
export default function ProductGroupManageModal({ groupId, open, onClose, onChanged }: Props) {
  const { message } = App.useApp();
  const [group, setGroup] = useState<ProductGroup | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // 成员管理
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberSelected, setMemberSelected] = useState<string[]>([]);

  // 打样/报价
  const [sampleOpen, setSampleOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [sampleForm] = Form.useForm();
  const [quoteForm] = Form.useForm();

  const loadProducts = useCallback(async () => {
    try {
      const res = await productApi.getList({ page: 1, pageSize: 200 });
      const d = res.data?.data;
      if (d) setProducts(d.list);
    } catch { /* ignore */ }
  }, []);

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    try {
      const res = await productGroupApi.getById(groupId);
      const d = res.data?.data;
      if (d) setGroup(d);
    } catch { message.error('加载产品组失败'); }
  }, [groupId, message]);

  useEffect(() => {
    if (open && groupId) {
      loadGroup();
      loadProducts();
    }
  }, [open, groupId, loadGroup, loadProducts]);

  const triggerChanged = () => { loadGroup(); onChanged?.(); };

  const openEdit = () => {
    if (!group) return;
    form.resetFields();
    form.setFieldsValue({
      name: group.name,
      description: group.description ?? '',
      productIds: (group.productIds || '').split(',').filter(Boolean),
    });
    setSaving(true); // 复用 saving 作为编辑弹窗可见
  };

  const submit = async () => {
    if (!group) return;
    const values = await form.validateFields();
    try {
      await productGroupApi.update(group.id, values);
      message.success('已更新产品组');
      setSaving(false);
      triggerChanged();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '保存失败');
    }
  };

  const remove = async () => {
    if (!group) return;
    try {
      await productGroupApi.remove(group.id);
      message.success('已删除');
      onClose();
      onChanged?.();
    } catch {
      message.error('删除失败');
    }
  };

  const openMembers = () => {
    if (!group) return;
    // 组合成员来自 items（优先）或 products，取单品 id 列表
    const currentIds = (group.items || []).map((i) => i.productId).filter(Boolean) as string[];
    setMemberSelected(currentIds.length ? currentIds : (group.products || []).map((p) => p.id));
    setMemberOpen(true);
  };

  const saveMembers = async () => {
    if (!group) return;
    try {
      // 组合成员由 items 维护：整体覆盖为选中的单品 id 列表
      await productGroupApi.update(group.id, {
        items: memberSelected.map((id) => ({ productId: id })),
      });
      message.success('成员已更新');
      setMemberOpen(false);
      triggerChanged();
    } catch {
      message.error('更新成员失败');
    }
  };

  const openSample = () => { if (!group) return; sampleForm.resetFields(); setSampleOpen(true); };
  const openQuote = () => {
    if (!group) return;
    quoteForm.resetFields();
    quoteForm.setFieldsValue({ title: `${group.name} 报价单` });
    setQuoteOpen(true);
  };

  const submitSample = async () => {
    if (!group) return;
    const values = await sampleForm.validateFields();
    try {
      await sampleApi.apply({ targetType: 'GROUP', targetId: group.id, remark: values.remark });
      message.success('打样申请已提交');
      setSampleOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '提交失败');
    }
  };

  const submitQuote = async () => {
    if (!group) return;
    const values = await quoteForm.validateFields();
    try {
      await quoteApi.create({ targetType: 'GROUP', targetId: group.id, title: values.title, remark: values.remark, items: values.items });
      message.success('报价单已创建');
      setQuoteOpen(false);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建失败');
    }
  };

  const memberTags = (group?.products || []).slice(0, 6).map((p) => (
    <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {p.sku ? <span className="pm-prod-sku" style={{ padding: '1px 6px' }}>{p.sku}</span> : null}
      <span>{p.name}</span>
    </span>
  ));

  return (
    <Modal
      title={`产品组 · ${group?.name || ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
    >
      <div style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button icon={<TeamOutlined />} onClick={openMembers}>管理成员（{group?.productCount ?? (group?.products?.length || 0)} 个）</Button>
          <Button icon={<ExperimentOutlined />} onClick={openSample}>申请打样</Button>
          <Button icon={<FileTextOutlined />} onClick={openQuote}>创建报价</Button>
          <Button icon={<EditOutlined />} onClick={openEdit}>编辑</Button>
          <Popconfirm title="删除该产品组？" onConfirm={remove}>
            <Button danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      </div>

      <Divider style={{ margin: '8px 0 16px' }} />

      <div className="pm-group-detail">
        <div className="pm-group-desc" style={{ color: 'var(--c-text-secondary, #64748b)', marginBottom: 12 }}>
          {group?.description || '暂无备注'}
        </div>
        <div className="pm-group-members">
          {memberTags.length ? (
            <Space wrap>{memberTags}</Space>
          ) : (
            <Text type="secondary">暂无成员产品</Text>
          )}
        </div>
      </div>

      {/* 编辑 */}
      <Modal title="编辑产品组" open={saving} onCancel={() => setSaving(false)} onOk={submit} width={640} okText="保存">
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
      <Modal title="管理成员" open={memberOpen} onCancel={() => setMemberOpen(false)} onOk={saveMembers} width={640} okText="保存">
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
      <Modal title="申请打样" open={sampleOpen} onCancel={() => setSampleOpen(false)} onOk={submitSample} okText="提交申请">
        <Form form={sampleForm} layout="vertical">
          <Form.Item name="remark" label="打样说明">
            <Input.TextArea rows={4} placeholder="如 需要 3 件手板，颜色红色" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 创建报价 */}
      <Modal title="创建报价单" open={quoteOpen} onCancel={() => setQuoteOpen(false)} onOk={submitQuote} okText="创建">
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
    </Modal>
  );
}
