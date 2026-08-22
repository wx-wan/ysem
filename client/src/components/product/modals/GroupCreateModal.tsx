import React, { useState } from 'react';
import {
  Button, Space, Modal, Form, Input, Select, InputNumber, App, Typography, Divider,
} from 'antd';
import { PlusOutlined, DeleteOutlined, TeamOutlined, TagsOutlined } from '@ant-design/icons';
import {
  productApi, productGroupApi,
  ProductCraft, ProductAudience, ProductCategory, Certificate,
} from '../../../api/products';
import ProductImageList from '../../common/ProductImageList';

const { Text } = Typography;

type UserLite = { id: string; username: string; realName?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: () => void;
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  categories: ProductCategory[];
  users: UserLite[];
  certificates: Certificate[];
}

interface PendingProduct {
  id: string;
  name: string;
  sku: string;
}

function cleanNullValues<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  Object.keys(obj).forEach((k) => {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  });
  return out as Partial<T>;
}

/**
 * 组合创建：一套与单品一致的完整产品信息表单，可反复「添加单品」（每次生成一条 Product 并暂存），
 * 最后填写独立的「组合名称」生成产品组并将所有暂存单品加入。
 */
export default function GroupCreateModal({
  open, onClose, onCreated, crafts, audiences, categories, users, certificates,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [pending, setPending] = useState<PendingProduct[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const audienceId = Form.useWatch('audienceId', form);
  const visibility = Form.useWatch('visibility', form);

  const categoryOptions = (audiences.find((a) => a.id === audienceId)?.categories || []).map((c) => ({
    label: c.name, value: c.id,
  }));

  const resetAll = () => {
    form.resetFields();
    setPending([]);
    setGroupName('');
    setGroupDesc('');
  };

  const handleClose = () => {
    if (pending.length && !saving) {
      // 关前清理已生成但未成组的单品，避免脏数据
      Promise.all(pending.map((p) => productApi.remove(p.id).catch(() => null)));
    }
    resetAll();
    onClose();
  };

  const addProduct = async () => {
    try {
      const values = await form.validateFields();
      const extra = {
        craftIds: values.craftIds || [],
        audienceId: values.audienceId,
        categoryId: values.categoryId,
      };
      const data = {
        ...cleanNullValues(extra as Record<string, unknown>),
        ...cleanNullValues(values as Record<string, unknown>),
        unit: values.productType === 'GROUP' ? '套' : '个',
      } as Record<string, unknown>;
      delete data.productType;
      if ((data as any).visibility === 'PUBLIC') (data as any).visibleUserIds = [];

      const res = await productApi.create(data as any);
      const created = res.data?.data;
      if (!created?.id) throw new Error('创建产品未返回 id');

      setPending((prev) => [...prev, { id: created.id, name: values.name || '未命名', sku: values.sku || '' }]);
      // 保留分类选择，清空其余以便连续添加
      const keep = { craftIds: values.craftIds, audienceId: values.audienceId, categoryId: values.categoryId };
      form.resetFields();
      form.setFieldsValue(keep);
      message.success(`已添加单品「${values.name || ''}」`);
    } catch (err: any) {
      if (err?.response?.data?.message) message.error(err.response.data.message);
      else if (err?.message) message.error(err.message);
    }
  };

  const removePending = async (item: PendingProduct) => {
    setPending((prev) => prev.filter((p) => p.id !== item.id));
    try { await productApi.remove(item.id); } catch { /* ignore */ }
    message.success(`已移除单品「${item.name}」`);
  };

  const generateGroup = async () => {
    if (!groupName.trim()) { message.warning('请输入组合名称'); return; }
    if (!pending.length) { message.warning('请至少添加一个单品'); return; }
    setSaving(true);
    try {
      await productGroupApi.create({
        name: groupName.trim(),
        description: groupDesc || undefined,
        productIds: pending.map((p) => p.id),
      });
      message.success('产品组已创建');
      resetAll();
      onCreated?.();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建产品组失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="新建组合"
      open={open}
      onCancel={handleClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      {/* 已添加单品列表 */}
      <div style={{ marginBottom: 12 }}>
        <Text strong>已添加单品（{pending.length}）</Text>
        {pending.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {pending.map((p) => (
              <span
                key={p.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', border: '1px solid #e5e7eb', borderRadius: 14, background: '#f8fafc' }}
              >
                {p.sku && <span className="pm-prod-sku" style={{ padding: '1px 6px' }}>{p.sku}</span>}
                <span>{p.name}</span>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => removePending(p)} />
              </span>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ marginLeft: 8 }}>尚未添加单品</Text>
        )}
      </div>

      <Divider style={{ margin: '8px 0 16px' }} />

      {/* 单品信息表单（与单品新建字段一致） */}
      <Form form={form} layout="vertical" initialValues={{ productType: 'PRODUCT', visibility: 'PUBLIC' }}>
        <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
          <Input placeholder="如 浮雕刺绣花朵抱枕" />
        </Form.Item>
        <Form.Item name="sku" label="SKU 编号" rules={[{ required: true, message: '请输入 SKU' }]}>
          <Input placeholder="如 YS-PLW-001" />
        </Form.Item>

        <div className="pm-form-grid">
          <Form.Item name="craftIds" label="工艺" rules={[{ required: true, message: '请选择工艺' }]}>
            <Select mode="multiple" allowClear placeholder="可多选" options={crafts.map((c) => ({ label: c.name, value: c.id }))} />
          </Form.Item>
          <Form.Item name="audienceId" label="受众" rules={[{ required: true, message: '请选择受众' }]}>
            <Select allowClear placeholder="选择受众" options={audiences.map((a) => ({ label: a.name, value: a.id }))} />
          </Form.Item>
          <Form.Item name="categoryId" label="品类" rules={[{ required: true, message: '请选择品类' }]}>
            <Select allowClear placeholder="选择品类" disabled={!audienceId} options={categoryOptions} />
          </Form.Item>
        </div>

        <div className="pm-form-grid">
          <Form.Item name="sizeLength" label="长 (cm)">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>
          <Form.Item name="sizeWidth" label="宽 (cm)">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>
          <Form.Item name="sizeHeight" label="高 (cm)">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
          </Form.Item>
          <Form.Item name="weight" label="克重 (g)">
            <Input placeholder="0" />
          </Form.Item>
          <Form.Item name="productType" label="模式">
            <Select options={[{ label: '单品', value: 'PRODUCT' }, { label: '组合', value: 'GROUP' }]} />
          </Form.Item>
        </div>

        <Form.Item name="visibility" label="公开性" rules={[{ required: true }]}>
          <Select
            options={[
              { label: '公开（所有人可见）', value: 'PUBLIC' },
              { label: '不公开（仅指定人可见）', value: 'PRIVATE' },
            ]}
          />
        </Form.Item>
        {visibility === 'PRIVATE' && (
          <Form.Item name="visibleUserIds" label="可见人" rules={[{ required: true, message: '请选择可见人' }]}>
            <Select mode="multiple" allowClear placeholder="选择可见用户" options={users.map((u) => ({ label: u.realName || u.username, value: u.id }))} />
          </Form.Item>
        )}

        <Form.Item name="certificateIds" label="认证标准">
          <Select mode="multiple" allowClear placeholder="可多选" options={certificates.map((c) => ({ label: c.name, value: c.id }))} />
        </Form.Item>

        <Form.Item name="images" label="产品图片">
          <ProductImageList uploadUrl="/upload" />
        </Form.Item>

        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={2} placeholder="简短备注" />
        </Form.Item>
        <Form.Item name="description" label="详情描述">
          <Input.TextArea rows={3} placeholder="详细介绍商品特色、材质、核心功能卖点..." />
        </Form.Item>

        <Button type="dashed" icon={<PlusOutlined />} block onClick={addProduct}>
          添加单品
        </Button>
      </Form>

      <Divider style={{ margin: '16px 0' }} />

      {/* 组合名称（独立字段） */}
      <div className="pm-form-grid">
        <Form.Item label="组合名称" required style={{ marginBottom: 0 }}>
          <Input
            prefix={<TeamOutlined />}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="如 2024春季毛绒新品组"
          />
        </Form.Item>
        <Form.Item label="组合备注" style={{ marginBottom: 0 }}>
          <Input
            prefix={<TagsOutlined />}
            value={groupDesc}
            onChange={(e) => setGroupDesc(e.target.value)}
            placeholder="组合整体说明"
          />
        </Form.Item>
      </div>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <Space>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" icon={<TeamOutlined />} loading={saving} onClick={generateGroup}>
            生成组合
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
