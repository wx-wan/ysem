import React, { useCallback, useEffect, useState } from 'react';
import {
  App, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Statistic, Table, Tag, Tooltip, Switch,
} from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SAMPLE_ROUND_RESULT_TEXT,
  SAMPLE_STATUS_COLOR,
  SAMPLE_STATUS_TEXT,
  sampleOrderApi,
  type SampleOrder,
  type SampleOrderPayload,
  type SampleStatus,
} from '../api/sampleOrders';
import { salesApi } from '../api/sales';
import { customerApi } from '../api/customers';
import productApi from '../api/products';
import { buildTablePagination } from '../components/common/tablePagination';

/**
 * V1.0 打样管理页（SampleOrder）
 *
 * 数据源：/api/sample-orders（V1.0 controller），编号 SMP → SM-yyyyMMdd-0001。
 * 本页已脱离 legacy 统一订单接口，不再依赖 Order(SAMPLE) 语义。
 */

/** Database Decimal 经 JSON 到达前端为字符串 → number */
const num = (v?: string | number | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const formatMoney = (v?: string | number | null, currency?: string | null): string => {
  const n = num(v);
  if (n === null) return '-';
  return `${currency ? `${currency} ` : ''}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const CURRENCY_OPTIONS = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD'].map((v) => ({ label: v, value: v }));

const STATUS_OPTIONS = (Object.keys(SAMPLE_STATUS_TEXT) as SampleStatus[]).map((k) => ({
  label: SAMPLE_STATUS_TEXT[k],
  value: k,
}));

interface Opt {
  label: string;
  value: string;
}

const SamplePage: React.FC = () => {
  const { message } = App.useApp();

  const [list, setList] = useState<SampleOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<SampleStatus | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const [opportunityOptions, setOpportunityOptions] = useState<Opt[]>([]);
  const [customerOptions, setCustomerOptions] = useState<Opt[]>([]);
  const [productOptions, setProductOptions] = useState<Opt[]>([]);

  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SampleOrder | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<SampleOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sampleOrderApi.list({
        page,
        pageSize,
        status: statusFilter,
        keyword: keyword || undefined,
      });
      const d = res.data?.data;
      if (d) {
        setList(d.list || []);
        setTotal(d.total || 0);
      }
    } catch {
      // 错误提示由请求拦截器统一处理
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, keyword]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    (async () => {
      try {
        const [customers, opportunities, products] = await Promise.all([
          customerApi.options(),
          salesApi.list({ pageSize: '200' }),
          productApi.options(),
        ]);
        setCustomerOptions((customers.data?.data || []).map((c: any) => ({ label: c.companyName, value: c.id })));
        setOpportunityOptions(
          (opportunities.data?.data?.list || []).map((o: any) => ({
            label: `${o.opportunityNo || o.id.slice(0, 8)} ${o.title || ''}`.trim(),
            value: o.id,
          })),
        );
        setProductOptions((products.data?.data || []).map((p: any) => ({
          label: `${p.name}${p.sku ? ` · ${p.sku}` : ''}`,
          value: p.id,
        })));
      } catch {
        // 下拉失败不阻断列表展示
      }
    })();
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ quantity: 1, feeCurrency: 'USD', status: 'DRAFT' as SampleStatus, feeRecoverable: false });
    setModalOpen(true);
  };

  const openEdit = async (record: SampleOrder) => {
    setEditing(record);
    form.resetFields();
    setModalOpen(true);
    try {
      const res = await sampleOrderApi.get(record.id);
      const d = res.data?.data || record;
      form.setFieldsValue({
        customerId: d.customerId,
        opportunityId: d.opportunityId || undefined,
        productId: d.productId || undefined,
        productName: d.productName,
        sampleType: d.sampleType,
        quantity: d.quantity,
        requirement: d.requirement,
        targetPrice: d.targetPrice,
        status: d.status,
        feeAmount: num(d.feeAmount),
        feeCurrency: d.feeCurrency,
        feeRecoverable: d.feeRecoverable,
        notes: d.notes,
      });
    } catch {
      form.setFieldsValue({
        customerId: record.customerId,
        opportunityId: record.opportunityId || undefined,
        productId: record.productId || undefined,
        productName: record.productName,
        status: record.status,
        quantity: record.quantity,
        feeCurrency: record.feeCurrency,
        feeAmount: num(record.feeAmount),
      });
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    // 后端 SampleOrder.productName 为 NOT NULL 快照：未选产品时必须手填名称
    if (!values.productId && !values.productName) {
      message.error('请选择产品或填写产品名称');
      return;
    }

    const payload: SampleOrderPayload = {
      customerId: values.customerId,
      opportunityId: values.opportunityId ?? null,
      productId: values.productId ?? null,
      productName: values.productName || undefined,
      sampleType: values.sampleType ?? null,
      quantity: values.quantity != null ? Number(values.quantity) : 1,
      requirement: values.requirement ?? null,
      targetPrice: values.targetPrice ?? null,
      status: values.status,
      feeAmount: values.feeAmount != null ? Number(values.feeAmount) : undefined,
      feeCurrency: values.feeCurrency,
      feeRecoverable: !!values.feeRecoverable,
      notes: values.notes ?? null,
    };

    setSaving(true);
    try {
      if (editing) {
        await sampleOrderApi.update(editing.id, payload);
        message.success('保存成功');
      } else {
        await sampleOrderApi.create(payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await sampleOrderApi.remove(id);
      message.success('删除成功');
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await sampleOrderApi.get(id);
      setDetail(res.data?.data || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns = [
    {
      title: '打样单号',
      dataIndex: 'sampleNo',
      width: 180,
      render: (v: string, r: SampleOrder) => <a onClick={() => openDetail(r.id)}>{v || '-'}</a>,
    },
    {
      title: '客户',
      key: 'customer',
      width: 170,
      render: (_: any, r: SampleOrder) => r.customer?.companyName || '-',
    },
    { title: '产品', dataIndex: 'productName', ellipsis: true },
    {
      title: '样品类型',
      dataIndex: 'sampleType',
      width: 110,
      render: (v?: string) => v || '-',
    },
    { title: '数量', dataIndex: 'quantity', width: 80 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: SampleStatus) => <Tag color={SAMPLE_STATUS_COLOR[s]}>{SAMPLE_STATUS_TEXT[s] || s}</Tag>,
    },
    { title: '轮次', dataIndex: 'currentRound', width: 70, render: (v: number) => `第 ${v ?? 1} 轮` },
    {
      title: '打样费',
      key: 'feeAmount',
      width: 130,
      render: (_: any, r: SampleOrder) => (
        <Space size={4}>
          <span>{formatMoney(r.feeAmount, r.feeCurrency)}</span>
          {r.feeRecoverable && <Tag color="green" style={{ marginInlineEnd: 0 }}>可回收</Tag>}
        </Space>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 120,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: any, r: SampleOrder) => (
        <Space size={4}>
          <Tooltip title="详情">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Popconfirm title="确认删除该打样单？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic title="打样单数" value={total} suffix="单" />
          </Card>
        </Col>
      </Row>

      <Card
        variant="borderless"
        title="打样管理"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="按状态筛选"
              style={{ width: 150 }}
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
            />
            <Input.Search
              allowClear
              placeholder="搜索打样单号 / 产品"
              style={{ width: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onSearch={() => {
                setPage(1);
                fetchList();
              }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建打样单
            </Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={list}
          loading={loading}
          size="middle"
          scroll={{ x: 1300 }}
          pagination={{
            ...buildTablePagination({
              total,
              page,
              pageSize,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }),
          }}
        />
      </Card>

      {/* 详情 */}
      <Modal
        title={`打样单详情${detail ? ` · ${detail.sampleNo}` : ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={880}
      >
        {detailLoading && <div>加载中…</div>}
        {!detailLoading && detail && (
          <div>
            <Row gutter={16}>
              <Col span={12}>客户：{detail.customer?.companyName || '-'}</Col>
              <Col span={12}>商机：{detail.opportunity?.opportunityNo || '-'}</Col>
              <Col span={12}>产品：{detail.productName || '-'}</Col>
              <Col span={12}>样品类型：{detail.sampleType || '-'}</Col>
              <Col span={12}>数量：{detail.quantity}</Col>
              <Col span={12}>目标价：{detail.targetPrice || '-'}</Col>
              <Col span={12}>
                状态：
                <Tag color={SAMPLE_STATUS_COLOR[detail.status]}>
                  {SAMPLE_STATUS_TEXT[detail.status] || detail.status}
                </Tag>
              </Col>
              <Col span={12}>当前轮次：第 {detail.currentRound} 轮</Col>
              <Col span={12}>打样费：{formatMoney(detail.feeAmount, detail.feeCurrency)}</Col>
              <Col span={12}>费用可回收：{detail.feeRecoverable ? '是' : '否'}</Col>
              {detail.requirement && <Col span={24}>要求：{detail.requirement}</Col>}
              {detail.notes && <Col span={24}>备注：{detail.notes}</Col>}
            </Row>

            <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>打样轮次</div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.rounds || []}
              locale={{ emptyText: '暂无轮次记录' }}
              columns={[
                { title: '轮次', dataIndex: 'roundNo', width: 70, render: (v: number) => `第 ${v} 轮` },
                {
                  title: '设计',
                  dataIndex: 'designAt',
                  render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
                },
                { title: '开模', dataIndex: 'moldAt', render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-') },
                { title: '寄样', dataIndex: 'sentAt', render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-') },
                { title: '单号', dataIndex: 'trackingNo', render: (v?: string) => v || '-' },
                {
                  title: '结果',
                  dataIndex: 'result',
                  width: 90,
                  render: (v: keyof typeof SAMPLE_ROUND_RESULT_TEXT) => SAMPLE_ROUND_RESULT_TEXT[v] || v,
                },
              ]}
            />

            {(detail.salesOrders || []).length > 0 && (
              <>
                <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>下游销售订单（只读）</div>
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.salesOrders || []}
                  columns={[
                    { title: '订单号', dataIndex: 'orderNo' },
                    { title: '状态', dataIndex: 'status', width: 140 },
                  ]}
                />
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 新建 / 编辑 */}
      <Modal
        title={editing ? `编辑打样单 · ${editing.sampleNo}` : '新建打样单'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        width={760}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ quantity: 1, feeCurrency: 'USD', status: 'DRAFT' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择客户" options={customerOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="opportunityId" label="商机（可选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择商机"
                  options={opportunityOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="productId" label="产品">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择产品（或手填名称）"
                  options={productOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="productName" label="产品名称（手填快照）">
                <Input placeholder="未选择产品时必填" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleType" label="样品类型">
                <Input placeholder="手工样 / 开模样 / 量产样" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="quantity" label="数量">
                <InputNumber style={{ width: '100%' }} min={0} precision={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="feeAmount" label="打样费">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="feeCurrency" label="费用币种">
                <Select options={CURRENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="feeRecoverable" label="费用可回收" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="targetPrice" label="目标价">
                <Input placeholder="客户目标价（可含区间描述）" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="requirement" label="打样要求">
                <Input />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SamplePage;
