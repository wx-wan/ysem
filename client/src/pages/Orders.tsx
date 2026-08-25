import React, { useEffect, useMemo, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, DatePicker, Tag, message,
  Space, Card, Row, Col, Statistic, Popconfirm, Typography, Tooltip, App,
} from 'antd';
import { PlusOutlined, SearchOutlined, ReloadOutlined, EyeOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { orderApi, customerApi, Order, OrderItem } from '../api/customers';
import { ORDER_TYPES, getOrderTypeMeta } from '../api/orders';
import SegmentedTabBar from '../components/common/SegmentedTabBar';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

type DocStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
type TabKey = 'ALL' | 'QUOTE' | 'SAMPLE' | 'ORDER';

const STATUS_OPTIONS: { label: string; value: DocStatus; color: string }[] = [
  { label: '草稿', value: 'DRAFT', color: 'default' },
  { label: '待审批', value: 'SUBMITTED', color: 'processing' },
  { label: '已通过', value: 'APPROVED', color: 'success' },
  { label: '已驳回', value: 'REJECTED', color: 'error' },
];

// 顶部 Tab（仅保留三类业务单据：报价单 / 打样单 / 正式订单）
const TAB_WHITELIST: OrderTypeKey[] = ['QUOTE', 'SAMPLE', 'ORDER'];
type OrderTypeKey = 'QUOTE' | 'SAMPLE' | 'ORDER';

const TAB_OPTIONS: { label: string; key: TabKey }[] = [
  { label: '全部', key: 'ALL' },
  ...ORDER_TYPES.filter((t) => TAB_WHITELIST.includes(t.key as OrderTypeKey)).map((t) => ({ label: t.label, key: t.key as TabKey })),
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

export default function OrdersPage({ fixedType }: { fixedType?: 'QUOTE' | 'SAMPLE' | 'ORDER' } = {}) {
  const { message: msg } = App.useApp();
  const user = useCurrentUser();
  const [tab, setTab] = useState<TabKey>(fixedType || 'ALL');
  const [status, setStatus] = useState<DocStatus | undefined>();
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<Order[]>([]);
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

  const load = async () => {
    setLoading(true);
    try {
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
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [page, pageSize, tab, status]);

  useEffect(() => {
    if (createOpen) {
      customerApi.listMy({ pageSize: 200 }).then((r) => setCustomers(r.data?.data?.list || []));
      form.resetFields();
      form.setFieldsValue({ type: (tab === 'ALL' ? 'ORDER' : tab) as any, status: 'DRAFT' });
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

  return (
    <div className="orders-page">
      <div className="orders-toolbar">
        <Title level={4} style={{ margin: 0 }}>订单管理</Title>
        {!fixedType && (
          <SegmentedTabBar options={TAB_OPTIONS} value={tab} onChange={(v) => { setTab(v as TabKey); setPage(1); }} />
        )}
        <Space>
          <Select
            placeholder="审批状态"
            allowClear
            style={{ width: 130 }}
            options={STATUS_OPTIONS}
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
          />
          <Input
            placeholder="搜索单号/客户"
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onBlur={load}
            onPressEnter={load}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建单据</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}><Card><Statistic title="单据数" value={total} /></Card></Col>
        <Col span={8}><Card><Statistic title="总金额" value={totalAmount} precision={2} prefix="CNY" /></Card></Col>
        <Col span={8}><Card><Statistic title="当前类型" value={TAB_OPTIONS.find((x) => x.key === tab)?.label} /></Card></Col>
      </Row>

      <Table
        rowKey="id"
        loading={loading}
        columns={orderColumns}
        dataSource={data}
        pagination={{ current: page, pageSize, total, showSizeChanger: true, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
      />

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
    </div>
  );
}
