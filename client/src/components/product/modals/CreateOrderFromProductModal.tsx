import React, { useEffect, useState } from 'react';
import { Modal, Form, Select, Input, InputNumber, Table, App, Alert, Tag } from 'antd';
import { customerApi, Customer } from '../../../api/customers';
import { salesApi, SalesItem } from '../../../api/sales';
import { quotationApi, type QuotationItemInput } from '../../../api/quotations';
import { sampleOrderApi } from '../../../api/sampleOrders';

/**
 * 基于产品 / 组合创建报价单或打样单（V1.0 双分支）
 *
 * ADR-6B-03：保留 QUOTE / SAMPLE 双分支
 *   QUOTE  → POST /api/quotations
 *   SAMPLE → POST /api/sample-orders
 * 已脱离 legacy `/api/orders`（旧 quoteApi.create / sampleApi.apply，type=SAMPLE|QUOTE）。
 *
 * 契约差异（V1.0 强制）：
 *   - 不再发送 targetType / targetId / pipelineId；
 *   - `pipelineId`（旧商机字段）→ `opportunityId`；
 *   - QUOTE：`opportunityId` 必填（V1.0 Quotation.opportunityId 必填）；items 走 QuotationItem；
 *   - SAMPLE：V1.0 SampleOrder 为「单产品 + SampleRound」，无 items/targetType/targetId；
 *   - GROUP：不新增 ComboProduct 关联 —— QUOTE 以文本快照表达（productId 置空，不伪造组合 id）；
 *            SAMPLE 无法安全映射到单产品 → 明确阻止创建，不伪造数据。
 */

interface InitialItem {
  key?: string;
  productId?: string;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice?: number;
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
  onCreated?: (created: { id: string; businessNo: string; title: string }) => void;
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
  const [opportunities, setOpportunities] = useState<SalesItem[]>([]);
  const [oppLoading, setOppLoading] = useState(false);
  const [items, setItems] = useState<InitialItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ businessNo: string; title: string } | null>(null);

  // SAMPLE + GROUP：V1.0 SampleOrder 只能表达单产品，组合无法安全映射（不伪造 productId）
  const sampleGroupBlocked = type === 'SAMPLE' && targetType === 'GROUP';

  useEffect(() => {
    if (!open) return;
    setCreated(null);
    form.resetFields();
    setOpportunities([]);
    const normalized = (initialItems.length ? initialItems : (productName ? [{ name: productName, quantity: 1 }] : []))
      .map((it) => ({ ...it, key: it.key || genKey() }));
    setItems(normalized);
    customerApi
      .listMy({ pageSize: 200 })
      .then((r) => setCustomers(r.data?.data?.list || []))
      .catch(() => setCustomers([]));
  }, [open, initialItems, productName, form]);

  // 商机数据源：仅当前客户下的商机（Opportunity），切换客户即清空重载
  const handleCustomerChange = (cid?: string) => {
    form.setFieldValue('opportunityId', undefined);
    if (!cid) {
      setOpportunities([]);
      return;
    }
    setOppLoading(true);
    salesApi
      .listByCustomer(cid)
      .then((r) => setOpportunities(r.data?.data ?? []))
      .catch((err) => {
        console.warn('[CreateOrderFromProductModal] 加载客户商机失败', err);
        setOpportunities([]);
      })
      .finally(() => setOppLoading(false));
  };

  const updateItem = (idx: number, patch: Partial<InitialItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  // QUOTE 明细：targetType=PRODUCT 才携带真实 productId；GROUP 一律文本快照（禁止伪造 ComboProduct id）
  const buildQuotationItems = (): QuotationItemInput[] =>
    items.map((it, idx) => ({
      productId: targetType === 'PRODUCT' ? (it.productId || targetId) : null,
      productName: it.name || productName || '未命名',
      spec: it.spec ?? null,
      quantity: Number(it.quantity) || 0,
      unitPrice: it.unitPrice === undefined ? undefined : Number(it.unitPrice),
      amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      sort: idx,
    }));

  const handleOk = async () => {
    // 已创建成功：再次点击「完成」即关闭弹窗
    if (created) {
      onCancel();
      return;
    }
    if (sampleGroupBlocked) {
      message.warning('组合产品暂不支持直接申请打样，请在单个产品上申请打样');
      return;
    }
    const values = await form.validateFields();
    if (!items.length) {
      message.warning('请至少添加一条明细');
      return;
    }
    setSaving(true);
    try {
      if (type === 'QUOTE') {
        const res = await quotationApi.create({
          opportunityId: values.opportunityId,
          customerId: values.customerId,
          title: values.title || productName || '报价单',
          notes: values.remark || null,
          items: buildQuotationItems(),
        });
        const quotation = res.data?.data;
        setCreated({ businessNo: quotation?.quotationNo || '', title: quotation?.title || '' });
        onCreated?.({ id: quotation?.id || '', businessNo: quotation?.quotationNo || '', title: quotation?.title || '' });
      } else {
        // V1.0 SampleOrder = 单产品 + SampleRound：仅取主产品快照，不发送 items / targetType / targetId
        const first = items[0];
        const res = await sampleOrderApi.create({
          customerId: values.customerId,
          opportunityId: values.opportunityId || null,
          productId: targetType === 'PRODUCT' ? (first?.productId || targetId) : null,
          productName: first?.name || productName || '未命名',
          spec: first?.spec || null,
          quantity: Number(first?.quantity) || 1,
          targetPrice: first?.unitPrice === undefined ? null : String(Number(first.unitPrice)),
          notes: values.remark || null,
        });
        const sampleOrder = res.data?.data;
        setCreated({ businessNo: sampleOrder?.sampleNo || '', title: sampleOrder?.productName || '' });
        onCreated?.({ id: sampleOrder?.id || '', businessNo: sampleOrder?.sampleNo || '', title: sampleOrder?.productName || '' });
      }
      message.success(`${TYPE_LABEL[type]}已创建`);
    } catch (err: any) {
      message.error(err?.response?.data?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    {
      title: '绑定产品',
      dataIndex: 'productId',
      width: 120,
      render: (_: any, r: InitialItem) => (
        <span>
          {r.productId && targetType === 'PRODUCT' ? (
            <Tag color="geekblue">{productName}</Tag>
          ) : (
            <span style={{ opacity: 0.45 }}>{targetType === 'GROUP' ? '文本快照' : '未绑定'}</span>
          )}
        </span>
      ),
    },
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
      title: '报价单价',
      dataIndex: 'unitPrice',
      width: 110,
      render: (_: any, _r: InitialItem, idx: number) => (
        <InputNumber
          min={0}
          value={items[idx].unitPrice}
          placeholder="报价价格"
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
      okButtonProps={{ disabled: sampleGroupBlocked }}
    >
      {sampleGroupBlocked && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          title="组合产品暂不支持直接申请打样"
          description="V1.0 打样单只能归属单个产品（单产品 + 打样轮次），无法安全表达组合内容。请在产品详情中针对具体产品申请打样。"
        />
      )}
      {created && (
        <Alert
          type="success"
          showIcon
          style={{ marginBottom: 12 }}
          title={`${TYPE_LABEL[type]}已创建`}
          description={
            <div>
              <div>单据号：<Tag color="blue">{created.businessNo}</Tag></div>
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
        <Form.Item
          name="opportunityId"
          label="商机"
          rules={type === 'QUOTE' ? [{ required: true, message: '请选择商机' }] : undefined}
          extra={type === 'QUOTE' ? 'V1.0 报价单必须归属一个商机' : '打样单可不关联商机'}
        >
          <Select
            allowClear
            showSearch
            loading={oppLoading}
            placeholder="选择关联商机"
            optionFilterProp="label"
            options={opportunities.map((o) => ({
              label: `${o.opportunityNo || ''} ${o.title || ''}`.trim() || o.id,
              value: o.id,
            }))}
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
            <a
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  // GROUP 不绑定 targetId（组合 id 不是 Product id，绑定即为伪造）；PRODUCT 绑定当前产品
                  { name: '', quantity: 1, key: genKey(), productId: targetType === 'PRODUCT' ? targetId : undefined },
                ])
              }
            >
              添加明细行{targetType === 'PRODUCT' ? '（绑定当前产品）' : '（文本快照）'}
            </a>
          )}
        />
        <Form.Item name="remark" label="备注" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} placeholder="备注说明" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
