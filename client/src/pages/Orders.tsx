import React, { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Tag, message,
  Space, Card, Row, Col, Statistic, Popconfirm, Typography, Segmented, Tooltip, App,
} from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EyeOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { orderApi, customerApi, paymentApi, profitApi, Order, OrderItem, PaymentRecord, ProfitRecord } from '../api/customers';
import { ORDER_TYPES, getOrderTypeMeta } from '../api/orders';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

type DocStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
type TabKey = 'ALL' | 'QUOTE' | 'SAMPLE' | 'ORDER' | 'PRODUCTION' | 'SHIPPED' | 'PAYMENT' | 'PROFIT';

const STATUS_OPTIONS: { label: string; value: DocStatus; color: string }[] = [
  { label: '草稿', value: 'DRAFT', color: 'default' },
  { label: '待审批', value: 'SUBMITTED', color: 'processing' },
  { label: '已通过', value: 'APPROVED', color: 'success' },
  { label: '已驳回', value: 'REJECTED', color: 'error' },
];

// 顶部 Tab（销售记录按类型切换）
const TAB_OPTIONS: { label: string; value: TabKey }[] = [
  { label: '全部', value: 'ALL' },
  ...ORDER_TYPES.map((t) => ({ label: t.label, value: t.key as TabKey })),
  { label: '付款单', value: 'PAYMENT' },
  { label: '利润单', value: 'PROFIT' },
];

const ORDER_TYPE_VALUE = ORDER_TYPES.map((t) => t.key) as string[];

// 当前登录用户（用于判断是否展示审批按钮，实际权限后端校验）
function useCurrentUser() {
  try {
    const raw = localStorage.getItem('ysem_user');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

export default function OrdersPage() {
  const { message: msg } = App.useApp();
  const user = useCurrentUser();
  const [tab, setTab] = useState<TabKey>('ALL');
  const [status, setStatus] = useState<DocStatus | undefined>();
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<Order[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [profits, setProfits] = useState<ProfitRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const [detail, setDetail] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [customers, setCustomers] = useState<{ id: string; companyName: string }[]>([]);

  const isPaymentTab = tab === 'PAYMENT';
  const isProfitTab = tab === 'PROFIT';
  const isOrderTab = !isPaymentTab && !isProfitTab;

  const load = async () => {
    setLoading(true);
    try {
      if (isPaymentTab) {
        const res = await paymentApi.list({ keyword: keyword || undefined });
        setPayments(res.data?.data || []);
        setTotal((res.data?.data || []).length);
        setTotalAmount(0);
      } else if (isProfitTab) {
        const res = await profitApi.list({ keyword: keyword || undefined });
        setProfits(res.data?.data || []);
        setTotal((res.data?.data || []).length);
        setTotalAmount(0);
      } else {
        const typeParam = tab === 'ALL' ? undefined : tab;
        const res = await orderApi.list({
          page, pageSize, type: typeParam,
          status: status || undefined,
          keyword: keyword || undefined,
        });
        const r = res.data?.data;
        if (r) {
          setData(r.list);
          setTotal(r.total);
          setTotalAmount(r.totalAmount || 0);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, tab, status]);

  useEffect(() => {
    if (createOpen && isOrderTab) {
      customerApi.listMy({ pageSize: 200 }).then((r) => setCustomers(r.data?.data?.list || []));
      form.resetFields();
      form.setFieldsValue({ type: tab === 'ALL' ? 'ORDER' : tab, status: 'DRAFT' });
    }
  }, [createOpen, tab, form]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await orderApi.getById(id);
      setDetail(res.data?.data || null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSubmit = async (id: string) => {
    await orderApi.submit(id);
    msg.success('已提交审批');
    load();
    if (detail?.id === id) openDetail(id);
  };
  const handleApprove = async (id: string) => {
    try {
      await orderApi.approve(id);
      msg.success('审批通过');
      load(); openDetail(id);
    } catch (e: any) { msg.error(e?.response?.data?.message || '操作失败'); }
  };
  const handleReject = async (id: string) => {
    try {
      await orderApi.reject(id);
      msg.success('已驳回');
      load(); openDetail(id);
    } catch (e: any) { msg.error(e?.response?.data?.message || '操作失败'); }
  };

  const handleCreate = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      const items: OrderItem[] = (v.items || []).map((it: any) => ({
        productId: it.productId, name: it.name, spec: it.spec,
        quantity: Number(it.quantity) || 1, unitPrice: it.unitPrice ? Number(it.unitPrice) : undefined,
        amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      }));
      const type = (v.type && ORDER_TYPE_VALUE.includes(v.type) ? v.type : 'ORDER');
      await orderApi.create({
        ...v,
        type,
        items,
        amountCNY: items.reduce((s, it) => s + (it.amount || 0), 0),
      });
      msg.success('创建成功');
      setCreateOpen(false);
      load();
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const detailItems: OrderItem[] = useMemo(() => {
    if (!detail?.items) return [];
    try { return typeof detail.items === 'string' ? JSON.parse(detail.items) : detail.items; }
    catch { return []; }
  }, [detail]);

  // 订单类列
  const orderColumns = [
    { title: '单号', dataIndex: 'orderNo', render: (t: string, r: Order) => <a onClick={() => openDetail(r.id)}>{t || r.id.slice(0, 8)}</a> },
    { title: '客户', dataIndex: ['customer', 'companyName'], render: (_: any, r: Order) => r.customer?.companyName || '-' },
    {
      title: '类型', dataIndex: 'type',
      render: (t: string) => { const m = getOrderTypeMeta(t); return <Tag color={m.color}>{m.label}</Tag>; },
    },
    {
      title: '金额', dataIndex: 'amountCNY',
      render: (v: number, r: Order) => (v != null ? `${r.currency || 'CNY'} ${v.toFixed(2)}` : '-'),
    },
    {
      title: '状态', dataIndex: 'status',
      render: (st: DocStatus) => {
        const o = STATUS_OPTIONS.find((x) => x.value === st);
        return <Tag color={o?.color}>{o?.label}</Tag>;
      },
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD') : '-') },
    {
      title: '操作', width: 180,
      render: (_: any, r: Order) => (
        <Space size={4}>
          <Tooltip title="详情"><Button size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} /></Tooltip>
          {r.status === 'DRAFT' && <Button size="small" onClick={() => handleSubmit(r.id)}>提交</Button>}
          {r.status === 'SUBMITTED' && (
            <>
              <Popconfirm title="确定通过？" onConfirm={() => handleApprove(r.id)}>
                <Button size="small" type="primary" icon={<CheckOutlined />} />
              </Popconfirm>
              <Popconfirm title="确定驳回？" onConfirm={() => handleReject(r.id)}>
                <Button size="small" danger icon={<CloseOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  // 付款单列（记录收款比例）
  const paymentColumns = [
    { title: '付款单号', dataIndex: 'paymentNo', render: (t: string, r: PaymentRecord) => <a onClick={() => {/* 暂用订单详情 */}}>{t || r.id.slice(0, 8)}</a> },
    { title: '关联单据', dataIndex: ['order', 'orderNo'], render: (_: any, r: PaymentRecord) => r.order?.orderNo || r.order?.title || '-' },
    { title: '客户', dataIndex: ['customer', 'companyName'], render: (_: any, r: PaymentRecord) => r.customer?.companyName || '-' },
    { title: '收款日期', dataIndex: 'payDate', render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD') : '-') },
    { title: '收款金额', dataIndex: 'amount', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '收款比例', dataIndex: 'ratio', render: (v: number) => (v != null ? `${v}%` : '-') },
    { title: '方式', dataIndex: 'method', render: (t: string) => t || '-' },
    { title: '状态', dataIndex: 'status', render: (t: string) => <Tag color={t === 'RECEIVED' ? 'success' : 'processing'}>{t === 'RECEIVED' ? '已收' : '待收'}</Tag> },
  ];

  // 利润单列
  const profitColumns = [
    { title: '利润单号', dataIndex: 'profitNo', render: (t: string, r: ProfitRecord) => t || r.id.slice(0, 8) },
    { title: '关联单据', dataIndex: ['order', 'orderNo'], render: (_: any, r: ProfitRecord) => r.order?.orderNo || r.order?.title || '-' },
    { title: '客户', dataIndex: ['customer', 'companyName'], render: (_: any, r: ProfitRecord) => r.customer?.companyName || '-' },
    { title: '收入', dataIndex: 'revenue', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '成本', dataIndex: 'cost', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '利润', dataIndex: 'profit', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '利润率', dataIndex: 'margin', render: (v: number) => (v != null ? `${v.toFixed(1)}%` : '-') },
  ];

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <Title level={4} style={{ margin: 0 }}>订单管理</Title>
        <Segmented options={TAB_OPTIONS} value={tab} onChange={(v) => { setTab(v as TabKey); setPage(1); }} />
        <Space>
          {isOrderTab && (
            <Select
              placeholder="审批状态"
              allowClear
              style={{ width: 130 }}
              options={STATUS_OPTIONS}
              value={status}
              onChange={(v) => { setStatus(v); setPage(1); }}
            />
          )}
          <Input
            placeholder={isPaymentTab ? '搜索付款单/客户' : isProfitTab ? '搜索利润单/客户' : '搜索单号/客户'}
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onBlur={load}
            onPressEnter={load}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          {isOrderTab && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建单据</Button>
          )}
          {isPaymentTab && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建付款单</Button>
          )}
          {isProfitTab && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建利润单</Button>
          )}
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title={isPaymentTab ? '付款单数' : isProfitTab ? '利润单数' : '单据数'} value={total} /></Card></Col>
        <Col span={8}><Card><Statistic title="总金额" value={totalAmount} precision={2} prefix="CNY" /></Card></Col>
        <Col span={8}><Card><Statistic title="当前类型" value={TAB_OPTIONS.find((x) => x.value === tab)?.label} /></Card></Col>
      </Row>

      {isOrderTab && (
        <Table
          rowKey="id"
          loading={loading}
          columns={orderColumns}
          dataSource={data}
          pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
        />
      )}
      {isPaymentTab && (
        <Table rowKey="id" loading={loading} columns={paymentColumns} dataSource={payments} pagination={false} />
      )}
      {isProfitTab && (
        <Table rowKey="id" loading={loading} columns={profitColumns} dataSource={profits} pagination={false} />
      )}

      {/* 详情抽屉 */}
      <Modal title={`单据详情${detail ? ` · ${detail.orderNo}` : ''}`} open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} width={720}>
        {detailLoading && <div>加载中…</div>}
        {detail && (
          <div>
            <Row gutter={16}>
              <Col span={12}>客户：{detail.customer?.companyName || '-'}</Col>
              <Col span={12}>类型：{<Tag color={getOrderTypeMeta(detail.type).color}>{getOrderTypeMeta(detail.type).label}</Tag>}</Col>
              <Col span={12}>状态：{STATUS_OPTIONS.find((x) => x.value === detail.status)?.label}</Col>
              <Col span={12}>金额：{detail.currency || 'CNY'} {detail.amountCNY?.toFixed(2) || '-'}</Col>
              {detail.pipelineId && <Col span={12}>绑定商机：{detail.pipelineId}</Col>}
              {detail.remark && <Col span={24}>备注：{detail.remark}</Col>}
            </Row>
            <Title level={5} style={{ marginTop: 16 }}>明细</Title>
            <Table
              size="small"
              rowKey={(_, i) => String(i)}
              pagination={false}
              dataSource={detailItems}
              columns={[
                { title: '名称', dataIndex: 'name' },
                { title: '规格', dataIndex: 'spec' },
                { title: '数量', dataIndex: 'quantity' },
                { title: '单价', dataIndex: 'unitPrice', render: (v: number) => (v != null ? v.toFixed(2) : '-') },
                { title: '金额', dataIndex: 'amount', render: (v: number) => (v != null ? v.toFixed(2) : '-') },
              ]}
            />
            <Space style={{ marginTop: 16 }}>
              {detail.status === 'DRAFT' && <Button onClick={() => handleSubmit(detail.id)}>提交审批</Button>}
              {detail.status === 'SUBMITTED' && (
                <>
                  <Popconfirm title="确定通过？" onConfirm={() => handleApprove(detail.id)}>
                    <Button type="primary">审批通过</Button>
                  </Popconfirm>
                  <Popconfirm title="确定驳回？" onConfirm={() => handleReject(detail.id)}>
                    <Button danger>驳回</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          </div>
        )}
      </Modal>

      {/* 新建订单类单据 */}
      {isOrderTab && (
        <Modal title={`新建${tab === 'ALL' ? '单据' : getOrderTypeMeta(tab).label}`} open={createOpen} onCancel={() => setCreateOpen(false)} onOk={handleCreate} confirmLoading={saving} width={680}>
          <Form form={form} layout="vertical">
            <Form.Item name="type" label="单据类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select options={ORDER_TYPES.map((t) => ({ label: t.label, value: t.key }))} />
            </Form.Item>
            <Form.Item name="title" label="单据标题">
              <Input placeholder="标题" />
            </Form.Item>
            <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
              <Select showSearch optionFilterProp="label" options={customers.map((c) => ({ label: c.companyName, value: c.id }))} />
            </Form.Item>
            <Form.Item name="orderDate" label="单据日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="amountCNY" label="金额（CNY）">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="depositAmount" label="预付款金额（仅正式订单）">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input.TextArea rows={3} />
            </Form.Item>
          </Form>
        </Modal>
      )}

      {/* 新建付款单 */}
      {isPaymentTab && (
        <PaymentCreateModal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => { setCreateOpen(false); load(); }} />
      )}

      {/* 新建利润单 */}
      {isProfitTab && (
        <ProfitCreateModal open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => { setCreateOpen(false); load(); }} />
      )}
    </div>
  );
}

// ========== 付款单新建弹窗 ==========
function PaymentCreateModal({ open, onCancel, onOk }: { open: boolean; onCancel: () => void; onOk: () => void }) {
  const { message: msg } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<{ id: string; orderNo?: string; title?: string }[]>([]);

  useEffect(() => {
    if (open) {
      orderApi.list({ pageSize: 200 }).then((r) => setOrders(r.data?.data?.list || []));
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await paymentApi.create({
        orderId: v.orderId,
        payDate: v.payDate ? dayjs(v.payDate).format('YYYY-MM-DD') : undefined,
        amount: v.amount,
        ratio: v.ratio,
        method: v.method,
        status: v.status || 'RECEIVED',
        remark: v.remark,
      });
      msg.success('创建成功');
      onOk();
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="新建付款单" open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label="关联单据" rules={[{ required: true, message: '请选择单据' }]}>
          <Select showSearch optionFilterProp="label" options={orders.map((o) => ({ label: `${o.orderNo || ''} ${o.title || ''}`, value: o.id }))} />
        </Form.Item>
        <Form.Item name="payDate" label="收款日期">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="amount" label="收款金额（CNY）">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="ratio" label="收款比例（%）">
          <InputNumber style={{ width: '100%' }} min={0} max={100} />
        </Form.Item>
        <Form.Item name="method" label="收款方式">
          <Input placeholder="电汇 / 信用证 / 支付宝..." />
        </Form.Item>
        <Form.Item name="status" label="状态" initialValue="RECEIVED">
          <Select options={[{ label: '已收', value: 'RECEIVED' }, { label: '待收', value: 'PENDING' }]} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ========== 利润单新建弹窗 ==========
function ProfitCreateModal({ open, onCancel, onOk }: { open: boolean; onCancel: () => void; onOk: () => void }) {
  const { message: msg } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState<{ id: string; orderNo?: string; title?: string }[]>([]);

  useEffect(() => {
    if (open) {
      orderApi.list({ pageSize: 200 }).then((r) => setOrders(r.data?.data?.list || []));
      form.resetFields();
    }
  }, [open, form]);

  const handleOk = async () => {
    const v = await form.validateFields();
    setSaving(true);
    try {
      await profitApi.create({
        orderId: v.orderId,
        revenue: v.revenue,
        cost: v.cost,
        currency: 'CNY',
        remark: v.remark,
      });
      msg.success('创建成功');
      onOk();
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="新建利润单" open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={saving} width={600}>
      <Form form={form} layout="vertical">
        <Form.Item name="orderId" label="关联单据" rules={[{ required: true, message: '请选择单据' }]}>
          <Select showSearch optionFilterProp="label" options={orders.map((o) => ({ label: `${o.orderNo || ''} ${o.title || ''}`, value: o.id }))} />
        </Form.Item>
        <Form.Item name="revenue" label="收入（CNY）">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="cost" label="成本（CNY）">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input.TextArea rows={3} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
