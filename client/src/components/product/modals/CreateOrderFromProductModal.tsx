import React, { useEffect, useState } from 'react';
import { Modal, Form, Select, Input, InputNumber, Table, App, Alert, Tag } from 'antd';
import { customerApi, Customer } from '../../../api/customers';
import { salesApi } from '../../../api/sales';
import { quoteApi, sampleApi } from '../../../api/products';

interface InitialItem {
  key?: string;
  productId?: string;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice?: number;
  pipelineId?: string;
}

const genKey = () => Math.random().toString(36).slice(2);

interface Props {
  open: boolean;
  type: 'QUOTE' | 'SAMPLE';
  targetType: 'PRODUCT' | 'GROUP';
  targetId: string;
  productName?: string;
  initialItems?: InitialItem[];
  onCancel: () => void;
  onCreated?: (order: any) => void;
}

const TYPE_LABEL: Record<string, string> = { QUOTE: '报价单', SAMPLE: '打样单' };

export default function CreateOrderFromProductModal({
  open,
  type,
  targetType,
  targetId,
  productName,
  initialItems = [],
  onCancel,
  onCreated,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [items, setItems] = useState<InitialItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; orderNo: string; title: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    form.resetFields();
    const normalized = (initialItems.length ? initialItems : (productName ? [{ name: productName, quantity: 1 }] : []))
      .map((it) => ({ ...it, key: it.key || genKey() }));
    setItems(normalized);
    customerApi
      .listMy({ pageSize: 200 })
      .then((r) => setCustomers(r.data?.data?.list || []))
      .catch(() => setCustomers([]));
  }, [open, initialItems, productName, form]);

  const handleCustomerChange = (cid?: string) => {
    if (!cid) {
      setPipelines([]);
      return;
    }
    salesApi
      .listByCustomer(cid)
      .then((r) => setPipelines(r.data?.data || []))
      .catch(() => setPipelines([]));
  };

  const updateItem = (idx: number, patch: Partial<InitialItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const handleOk = async () => {
    // 已创建成功：再次点击「完成」即关闭弹窗
    if (created) {
      onCancel();
      return;
    }
    const values = await form.validateFields();
    if (!items.length) {
      message.warning('请至少添加一条明细');
      return;
    }
    const payloadItems = items.map(({ key, ...it }) => ({
      ...it,
      amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      pipelineId: it.pipelineId || values.pipelineId,
    }));
    setSaving(true);
    try {
      const data = {
        title: values.title || productName || `${type === 'QUOTE' ? '报价' : '打样'}单`,
        targetType,
        targetId,
        customerId: values.customerId,
        pipelineId: values.pipelineId,
        remark: values.remark,
        items: payloadItems,
      };
      const res = type === 'QUOTE'
        ? await quoteApi.create(data)
        : await sampleApi.apply(data);
      const order = res.data?.data;
      if (order) {
        setCreated({ id: order.id || '', orderNo: order.orderNo || '', title: order.title || '' });
        message.success(`${TYPE_LABEL[type]}已创建`);
        onCreated?.(order);
      }
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (_: any, _r: InitialItem, idx: number) => (
        <Input value={items[idx].name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
      ),
    },
    {
      title: '规格',
      dataIndex: 'spec',
      render: (_: any, _r: InitialItem, idx: number) => (
        <Input value={items[idx].spec} placeholder="规格/尺寸" onChange={(e) => updateItem(idx, { spec: e.target.value })} />
      ),
    },
    {
      title: '数量',
      dataIndex: 'quantity',
      width: 90,
      render: (_: any, _r: InitialItem, idx: number) => (
        <InputNumber min={1} value={items[idx].quantity} onChange={(v) => updateItem(idx, { quantity: Number(v) || 1 })} />
      ),
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      width: 110,
      render: (_: any, _r: InitialItem, idx: number) => (
        <InputNumber
          min={0}
          value={items[idx].unitPrice}
          placeholder="成本核算"
          onChange={(v) => updateItem(idx, { unitPrice: v === null ? undefined : Number(v) })}
        />
      ),
    },
  ];

  return (
    <Modal
      open={open}
      title={`基于${targetType === 'PRODUCT' ? '产品' : '组合'}创建${TYPE_LABEL[type]}`}
      onCancel={onCancel}
      onOk={handleOk}
      confirmLoading={saving}
      width={680}
      okText={created ? '完成' : '创建'}
    >
      {created && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${TYPE_LABEL[type]}已创建`}
          description={
            <div>
              <div>报价单 ID：<Tag color="blue">{created.orderNo}</Tag></div>
              {created.title && <div style={{ marginTop: 4 }}>标题：{created.title}</div>}
            </div>
          }
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="title" label="单据标题">
          <Input placeholder={`${productName || ''}${TYPE_LABEL[type]}`} />
        </Form.Item>
        <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
          <Select
            showSearch
            placeholder="选择客户"
            optionFilterProp="label"
            onChange={handleCustomerChange}
            options={customers.map((c) => ({ label: c.companyName, value: c.id }))}
          />
        </Form.Item>
        <Form.Item name="pipelineId" label="绑定商机（可选）">
          <Select
            allowClear
            placeholder="选择关联商机"
            options={pipelines.map((p) => ({ label: `${p.pipelineNumber} ${p.title}`, value: p.id }))}
          />
        </Form.Item>
        <div style={{ marginBottom: 8, fontWeight: 500 }}>明细</div>
        <Table
          size="small"
          rowKey="key"
          dataSource={items}
          columns={columns as any}
          pagination={false}
          footer={() => (
            <a onClick={() => setItems((prev) => [...prev, { name: '', quantity: 1, key: genKey() }])}>添加明细行</a>
          )}
        />
        <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} placeholder="备注说明" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
