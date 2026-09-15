import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  App, Button, Card, Col, DatePicker, Empty, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Segmented, Select, Space, Statistic, Table, Tag, Tooltip, theme,
} from 'antd';
import {
  AppstoreOutlined, ArrowRightOutlined, DeleteOutlined, EditOutlined, EyeOutlined,
  PlusOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  SALES_ORDER_FLOW,
  SALES_ORDER_STATUS_COLOR,
  SALES_ORDER_STATUS_TEXT,
  nextSalesOrderStatus,
  salesOrderApi,
  type SalesOrder,
  type SalesOrderItemInput,
  type SalesOrderPayload,
  type SalesOrderStatus,
} from '../api/salesOrders';
import { quotationApi } from '../api/quotations';
import { sampleOrderApi } from '../api/sampleOrders';
import { salesApi } from '../api/sales';
import { customerApi } from '../api/customers';
import productApi from '../api/products';
import { buildTablePagination } from '../components/common/tablePagination';

/**
 * V1.0 销售订单管理页（SalesOrder）
 *
 * 数据源：/api/sales-orders（V1.0 controller），编号 SO → SO-yyyyMMdd-0001。
 * 本页已脱离 legacy 统一订单接口；状态使用 V1.0 SalesOrderStatus 状态机（不再使用打样阶段模拟订单状态）。
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

const STATUS_OPTIONS = (Object.keys(SALES_ORDER_STATUS_TEXT) as SalesOrderStatus[]).map((k) => ({
  label: SALES_ORDER_STATUS_TEXT[k],
  value: k,
}));

/** 看板列：主状态链 + 取消（分支终态） */
const KANBAN_COLUMNS: SalesOrderStatus[] = [...SALES_ORDER_FLOW, 'CANCELLED'];

interface Opt {
  label: string;
  value: string;
}

const SalesOrdersPage: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('list');
  const [list, setList] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<SalesOrderStatus | undefined>(undefined);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const [customerOptions, setCustomerOptions] = useState<Opt[]>([]);
  const [opportunityOptions, setOpportunityOptions] = useState<Opt[]>([]);
  const [productOptions, setProductOptions] = useState<Opt[]>([]);
  const [quotationOptions, setQuotationOptions] = useState<Opt[]>([]);
  const [sampleOptions, setSampleOptions] = useState<Opt[]>([]);

  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SalesOrder | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<SalesOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await salesOrderApi.list({
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

  /** 上游报价 / 打样下拉：仅在弹窗打开时懒加载 */
  const loadUpstreamOptions = useCallback(async () => {
    try {
      const [quotations, samples] = await Promise.all([
        quotationApi.list({ pageSize: 100 }),
        sampleOrderApi.list({ pageSize: 100 }),
      ]);
      setQuotationOptions(
        (quotations.data?.data?.list || []).map((q) => ({ label: `${q.quotationNo} ${q.title}`.trim(), value: q.id })),
      );
      setSampleOptions(
        (samples.data?.data?.list || []).map((s) => ({
          label: `${s.sampleNo} ${s.productName}`.trim(),
          value: s.id,
        })),
      );
    } catch {
      // 上游下拉失败不影响主流程
    }
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency: 'USD', status: 'DRAFT' as SalesOrderStatus });
    setModalOpen(true);
    loadUpstreamOptions();
  };

  const openEdit = async (record: SalesOrder) => {
    setEditing(record);
    form.resetFields();
    setModalOpen(true);
    loadUpstreamOptions();
    try {
      const res = await salesOrderApi.get(record.id);
      const d = res.data?.data;
      if (d) {
        form.setFieldsValue({
          opportunityId: d.opportunityId,
          quotationId: d.quotationId || undefined,
          sampleOrderId: d.sampleOrderId || undefined,
          currency: d.currency,
          totalAmount: num(d.totalAmount),
          depositRatio: num(d.depositRatio),
          depositAmount: num(d.depositAmount),
          status: d.status,
          orderDate: d.orderDate ? dayjs(d.orderDate) : null,
          deliveryDate: d.deliveryDate ? dayjs(d.deliveryDate) : null,
          tradeTerms: d.tradeTerms,
          paymentTerms: d.paymentTerms,
          portOfLoading: d.portOfLoading,
          portOfDischarge: d.portOfDischarge,
          remark: d.remark,
          items: (d.items || []).map((it) => ({
            productId: it.productId || undefined,
            productName: it.productName,
            quantity: num(it.quantity),
            unitPrice: num(it.unitPrice),
          })),
        });
      }
    } catch {
      form.setFieldsValue({
        opportunityId: record.opportunityId,
        currency: record.currency,
        totalAmount: num(record.totalAmount),
        status: record.status,
      });
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const rawItems: any[] = values.items || [];

    const items: SalesOrderItemInput[] = [];
    for (let i = 0; i < rawItems.length; i += 1) {
      const it = rawItems[i];
      if (!it) continue;
      if (!it.productId && !it.productName) {
        message.error(`第 ${i + 1} 条明细请选择产品或填写名称`);
        return;
      }
      items.push({
        productId: it.productId ?? null,
        productName: it.productName ?? undefined,
        quantity: it.quantity != null ? Number(it.quantity) : undefined,
        unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
      });
    }

    const payload: SalesOrderPayload = {
      opportunityId: values.opportunityId,
      quotationId: values.quotationId ?? null,
      sampleOrderId: values.sampleOrderId ?? null,
      currency: values.currency,
      totalAmount: values.totalAmount != null ? Number(values.totalAmount) : undefined,
      depositRatio: values.depositRatio != null ? Number(values.depositRatio) : null,
      depositAmount: values.depositAmount != null ? Number(values.depositAmount) : null,
      status: values.status,
      orderDate: values.orderDate ? values.orderDate.format('YYYY-MM-DD') : null,
      deliveryDate: values.deliveryDate ? values.deliveryDate.format('YYYY-MM-DD') : null,
      tradeTerms: values.tradeTerms ?? null,
      paymentTerms: values.paymentTerms ?? null,
      portOfLoading: values.portOfLoading ?? null,
      portOfDischarge: values.portOfDischarge ?? null,
      remark: values.remark ?? null,
      items: items.length > 0 ? items : undefined,
    };

    if (payload.totalAmount == null && !payload.items) {
      message.error('请填写订单金额或至少一条明细');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await salesOrderApi.update(editing.id, payload);
        message.success('保存成功');
      } else {
        await salesOrderApi.create(payload);
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
      await salesOrderApi.remove(id);
      message.success('删除成功');
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const advanceStatus = async (o: SalesOrder) => {
    const next = nextSalesOrderStatus(o.status);
    if (!next) return;
    try {
      await salesOrderApi.update(o.id, { status: next });
      message.success(`已推进至「${SALES_ORDER_STATUS_TEXT[next]}」`);
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await salesOrderApi.get(id);
      setDetail(res.data?.data || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const stats = useMemo(() => {
    const amount = list.reduce((s, o) => s + (num(o.totalAmountCny) ?? 0), 0);
    const paid = list.reduce((s, o) => s + (num(o.paidAmountCny) ?? 0), 0);
    const inProgress = list.filter((o) => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length;
    return { amount, paid, inProgress };
  }, [list]);

  const columns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      width: 180,
      render: (v: string, r: SalesOrder) => <a onClick={() => openDetail(r.id)}>{v || '-'}</a>,
    },
    {
      title: '客户',
      key: 'customer',
      width: 170,
      render: (_: any, r: SalesOrder) => r.customer?.companyName || '-',
    },
    {
      title: '商机',
      key: 'opportunity',
      width: 160,
      render: (_: any, r: SalesOrder) => r.opportunity?.opportunityNo || '-',
    },
    {
      title: '报价单',
      key: 'quotation',
      width: 160,
      render: (_: any, r: SalesOrder) => r.quotation?.quotationNo || '-',
    },
    {
      title: '打样单',
      key: 'sampleOrder',
      width: 150,
      render: (_: any, r: SalesOrder) => r.sampleOrder?.sampleNo || '-',
    },
    {
      title: '金额',
      key: 'totalAmount',
      width: 150,
      render: (_: any, r: SalesOrder) => formatMoney(r.totalAmount, r.currency),
    },
    {
      title: '折合 CNY',
      key: 'totalAmountCny',
      width: 130,
      render: (_: any, r: SalesOrder) => formatMoney(r.totalAmountCny, 'CNY'),
    },
    {
      title: '已收（CNY）',
      key: 'paidAmountCny',
      width: 130,
      render: (_: any, r: SalesOrder) => formatMoney(r.paidAmountCny, 'CNY'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: SalesOrderStatus) => (
        <Tag color={SALES_ORDER_STATUS_COLOR[s]}>{SALES_ORDER_STATUS_TEXT[s] || s}</Tag>
      ),
    },
    {
      title: '订单日期',
      dataIndex: 'orderDate',
      width: 120,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '交期',
      dataIndex: 'deliveryDate',
      width: 120,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: any, r: SalesOrder) => (
        <Space size={4}>
          <Tooltip title="详情">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Popconfirm title="确认删除该订单？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const KanbanView = () => (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {KANBAN_COLUMNS.map((status) => {
        const colItems = list.filter((o) => o.status === status);
        return (
          <div
            key={status}
            style={{
              flex: '0 0 260px',
              background: token.colorFillQuaternary,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: 'calc(100vh - 320px)',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <Tag color={SALES_ORDER_STATUS_COLOR[status]} style={{ marginInlineEnd: 0 }}>
                {SALES_ORDER_STATUS_TEXT[status]}
              </Tag>
              <span style={{ color: token.colorTextSecondary }}>{colItems.length}</span>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
              {colItems.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" style={{ margin: '16px 0' }} />
              )}
              {colItems.map((o) => (
                <div
                  key={o.id}
                  style={{
                    background: token.colorBgContainer,
                    borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    padding: 12,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    <a onClick={() => openDetail(o.id)}>{o.orderNo}</a>
                  </div>
                  <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
                    {o.customer?.companyName || '-'}
                  </div>
                  <Space size={4} style={{ width: '100%', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: token.colorPrimary }}>
                      {formatMoney(o.totalAmount, o.currency)}
                    </span>
                    <Space size={2}>
                      <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(o)} />
                      </Tooltip>
                      <Tooltip title="推进到下一状态">
                        <Button
                          type="text"
                          size="small"
                          icon={<ArrowRightOutlined />}
                          disabled={!nextSalesOrderStatus(o.status)}
                          onClick={() => advanceStatus(o)}
                        />
                      </Tooltip>
                    </Space>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic title="订单总数" value={total} suffix="单" />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic title="本页金额合计（CNY）" value={stats.amount} precision={2} />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic title="本页已收（CNY）" value={stats.paid} precision={2} />
          </Card>
        </Col>
      </Row>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 20px',
          marginBottom: 16,
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Space>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'kanban' | 'list')}
            options={[
              { label: '看板', value: 'kanban', icon: <AppstoreOutlined /> },
              { label: '列表', value: 'list', icon: <UnorderedListOutlined /> },
            ]}
          />
          <Select
            allowClear
            placeholder="按状态筛选"
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
          />
          <Input.Search
            allowClear
            placeholder="搜索订单号/客户"
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onSearch={() => {
              setPage(1);
              fetchList();
            }}
          />
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建订单
        </Button>
      </div>

      {viewMode === 'kanban' ? (
        <KanbanView />
      ) : (
        <Card variant="borderless">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={loading}
            size="middle"
            scroll={{ x: 1700 }}
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
      )}

      {/* 详情 */}
      <Modal
        title={`订单详情${detail ? ` · ${detail.orderNo}` : ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={920}
      >
        {detailLoading && <div>加载中…</div>}
        {!detailLoading && detail && (
          <div>
            <Row gutter={16}>
              <Col span={12}>客户：{detail.customer?.companyName || '-'}</Col>
              <Col span={12}>商机：{detail.opportunity?.opportunityNo || '-'}</Col>
              <Col span={12}>报价单：{detail.quotation?.quotationNo || '-'}</Col>
              <Col span={12}>打样单：{detail.sampleOrder?.sampleNo || '-'}</Col>
              <Col span={12}>
                状态：
                <Tag color={SALES_ORDER_STATUS_COLOR[detail.status]}>
                  {SALES_ORDER_STATUS_TEXT[detail.status] || detail.status}
                </Tag>
              </Col>
              <Col span={12}>订单日期：{detail.orderDate ? dayjs(detail.orderDate).format('YYYY-MM-DD') : '-'}</Col>
              <Col span={12}>金额：{formatMoney(detail.totalAmount, detail.currency)}</Col>
              <Col span={12}>折合 CNY：{formatMoney(detail.totalAmountCny, 'CNY')}</Col>
              <Col span={12}>定金：{formatMoney(detail.depositAmount, detail.currency)}</Col>
              <Col span={12}>余款：{formatMoney(detail.balanceAmount, detail.currency)}</Col>
              <Col span={12}>已收（CNY）：{formatMoney(detail.paidAmountCny, 'CNY')}</Col>
              <Col span={12}>交期：{detail.deliveryDate ? dayjs(detail.deliveryDate).format('YYYY-MM-DD') : '-'}</Col>
              <Col span={12}>贸易条款：{detail.tradeTerms || '-'}</Col>
              <Col span={12}>付款条款：{detail.paymentTerms || '-'}</Col>
              <Col span={12}>起运港：{detail.portOfLoading || '-'}</Col>
              <Col span={12}>卸货港：{detail.portOfDischarge || '-'}</Col>
              {detail.cancelReason && <Col span={24}>取消原因：{detail.cancelReason}</Col>}
              {detail.remark && <Col span={24}>备注：{detail.remark}</Col>}
            </Row>

            <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>订单明细</div>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              locale={{ emptyText: '暂无明细' }}
              columns={[
                { title: '行号', dataIndex: 'lineNo', width: 60 },
                { title: '产品', dataIndex: 'productName' },
                { title: '规格', dataIndex: 'spec', render: (v?: string) => v || '-' },
                { title: '数量', dataIndex: 'quantity', render: (v: string) => num(v) ?? '-' },
                { title: '单价', dataIndex: 'unitPrice', render: (v: string) => formatMoney(v, detail.currency) },
                { title: '金额', dataIndex: 'amount', render: (v: string) => formatMoney(v, detail.currency) },
                { title: '已出货', dataIndex: 'shippedQty', render: (v: string) => num(v) ?? '-' },
              ]}
            />

            {((detail.productionOrders || []).length > 0 ||
              (detail.shipments || []).length > 0 ||
              (detail.payments || []).length > 0 ||
              detail.profit) && (
              <>
                <div style={{ marginTop: 16, marginBottom: 8, fontWeight: 600 }}>下游单据（只读）</div>
                <Table
                  size="small"
                  rowKey={(r: any) => `${r.kind}-${r.id}`}
                  pagination={false}
                  dataSource={[
                    ...(detail.productionOrders || []).map((p) => ({ ...p, kind: '生产单' })),
                    ...(detail.shipments || []).map((s) => ({ ...s, kind: '出运单' })),
                    ...(detail.payments || []).map((p) => ({
                      id: p.id,
                      kind: '收付款',
                      docNo: p.paymentNo,
                      status: `${p.direction} / ${p.status}`,
                    })),
                    ...(detail.profit
                      ? [{ id: detail.profit.id, kind: '利润单', docNo: detail.profit.profitNo, status: detail.profit.status }]
                      : []),
                  ]}
                  columns={[
                    { title: '类型', dataIndex: 'kind', width: 100 },
                    {
                      title: '单号',
                      key: 'docNo',
                      render: (_: any, r: any) => r.productionNo || r.shipmentNo || r.docNo || '-',
                    },
                    { title: '状态', dataIndex: 'status', width: 160 },
                  ]}
                />
              </>
            )}
          </div>
        )}
      </Modal>

      {/* 新建 / 编辑 */}
      <Modal
        title={editing ? `编辑订单 · ${editing.orderNo}` : '新建订单'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        width={880}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ currency: 'USD', status: 'DRAFT' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="opportunityId" label="商机" rules={[{ required: true, message: '请选择商机' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择商机（订单必须归属商机）"
                  options={opportunityOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quotationId" label="来源报价单（可选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择报价单"
                  options={quotationOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sampleOrderId" label="来源打样单（可选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择打样单"
                  options={sampleOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="币种">
                <Select options={CURRENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="totalAmount" label="订单金额" extra="留空则按明细汇总">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="depositRatio" label="定金比例（%）">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="depositAmount" label="定金金额">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="orderDate" label="订单日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deliveryDate" label="交期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tradeTerms" label="贸易条款">
                <Input placeholder="如 FOB / CIF" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="paymentTerms" label="付款条款">
                <Input placeholder="如 30% T/T, 70% before shipment" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="portOfLoading" label="起运港">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="portOfDischarge" label="卸货港">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="订单明细">
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item {...restField} name={[name, 'productId']} style={{ marginBottom: 0, width: 240 }}>
                        <Select
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          placeholder="选择产品"
                          options={productOptions}
                        />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'productName']} style={{ marginBottom: 0, width: 160 }}>
                        <Input placeholder="名称（手填）" />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'quantity']} style={{ marginBottom: 0, width: 100 }}>
                        <InputNumber style={{ width: '100%' }} min={0} placeholder="数量" />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'unitPrice']} style={{ marginBottom: 0, width: 120 }}>
                        <InputNumber style={{ width: '100%' }} min={0} placeholder="单价" />
                      </Form.Item>
                      <Button type="link" danger onClick={() => remove(name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>
                    添加明细
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SalesOrdersPage;
