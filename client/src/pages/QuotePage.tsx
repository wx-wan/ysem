import React, { useCallback, useEffect, useState } from 'react';
import {
  App, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm,
  Row, Select, Space, Statistic, Table, Tag, Tooltip,
} from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  QUOTATION_STATUS_COLOR,
  QUOTATION_STATUS_TEXT,
  quotationApi,
  type Quotation,
  type QuotationItemInput,
  type QuotationPayload,
  type QuotationStatus,
} from '../api/quotations';
import { salesApi } from '../api/sales';
import { customerApi } from '../api/customers';
import productApi from '../api/products';
import { buildTablePagination } from '../components/common/tablePagination';

/**
 * V1.0 报价管理页（Quotation）
 *
 * 数据源：/api/quotations（V1.0 controller），编号 QU → QU-yyyyMMdd-0001。
 * 本页已脱离 legacy 统一订单接口，不再依赖 Order(QUOTE) 语义。
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

// 币种：与后端 Currency enum 对齐的常用子集（USD 为 Quotation.currency 默认值）
const CURRENCY_OPTIONS = ['USD', 'CNY', 'EUR', 'GBP', 'JPY', 'HKD'].map((v) => ({ label: v, value: v }));

const STATUS_OPTIONS = (Object.keys(QUOTATION_STATUS_TEXT) as QuotationStatus[]).map((k) => ({
  label: QUOTATION_STATUS_TEXT[k],
  value: k,
}));

interface Opt {
  label: string;
  value: string;
}

const QuotePage: React.FC = () => {
  const { message } = App.useApp();

  const [list, setList] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<QuotationStatus | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const [opportunityOptions, setOpportunityOptions] = useState<Opt[]>([]);
  const [customerOptions, setCustomerOptions] = useState<Opt[]>([]);
  const [productOptions, setProductOptions] = useState<Opt[]>([]);

  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<Quotation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await quotationApi.list({ page, pageSize, status: statusFilter });
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
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 下拉数据源（商机 / 客户 / 产品）
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
    form.setFieldsValue({ currency: 'USD', status: 'DRAFT' as QuotationStatus });
    setModalOpen(true);
  };

  const openEdit = async (record: Quotation) => {
    setEditing(record);
    form.resetFields();
    setModalOpen(true);
    try {
      const res = await quotationApi.get(record.id);
      const d = res.data?.data;
      if (d) {
        form.setFieldsValue({
          opportunityId: d.opportunityId,
          title: d.title,
          currency: d.currency,
          totalAmount: num(d.totalAmount),
          validUntil: d.validUntil ? dayjs(d.validUntil) : null,
          status: d.status,
          tradeTerms: d.tradeTerms,
          paymentTerms: d.paymentTerms,
          leadTime: d.leadTime,
          portOfLoading: d.portOfLoading,
          notes: d.notes,
          items: (d.items || []).map((it) => ({
            productId: it.productId || undefined,
            productName: it.productName,
            quantity: num(it.quantity),
            unitPrice: num(it.unitPrice),
          })),
        });
      }
    } catch {
      // 详情失败时保留列表行数据编辑
      form.setFieldsValue({
        opportunityId: record.opportunityId,
        title: record.title,
        currency: record.currency,
        status: record.status,
        totalAmount: num(record.totalAmount),
      });
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const rawItems: any[] = values.items || [];

    const items: QuotationItemInput[] = [];
    for (let i = 0; i < rawItems.length; i += 1) {
      const it = rawItems[i];
      if (!it) continue;
      // 后端 parseItems：productId 缺失时必须显式提供 productName
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

    const payload: QuotationPayload = {
      opportunityId: values.opportunityId,
      title: values.title,
      currency: values.currency,
      status: values.status,
      validUntil: values.validUntil ? values.validUntil.format('YYYY-MM-DD') : null,
      tradeTerms: values.tradeTerms ?? null,
      paymentTerms: values.paymentTerms ?? null,
      leadTime: values.leadTime ?? null,
      portOfLoading: values.portOfLoading ?? null,
      notes: values.notes ?? null,
      totalAmount: values.totalAmount != null ? Number(values.totalAmount) : undefined,
      items: items.length > 0 ? items : undefined,
    };

    if (payload.totalAmount == null && !payload.items) {
      message.error('请填写报价金额或至少一条明细');
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await quotationApi.update(editing.id, payload);
        message.success('保存成功');
      } else {
        await quotationApi.create(payload);
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
      await quotationApi.remove(id);
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
      const res = await quotationApi.get(id);
      setDetail(res.data?.data || null);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const stats = {
    count: total,
    amount: list.reduce((s, q) => s + (num(q.totalAmountCny) ?? 0), 0),
  };

  const columns = [
    {
      title: '报价单号',
      dataIndex: 'quotationNo',
      width: 190,
      render: (v: string, r: Quotation) => <a onClick={() => openDetail(r.id)}>{v || '-'}</a>,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
      render: (v: number) => `v${v ?? 1}`,
    },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '客户',
      key: 'customer',
      width: 180,
      render: (_: any, r: Quotation) => r.customer?.companyName || '-',
    },
    {
      title: '商机',
      key: 'opportunity',
      width: 170,
      render: (_: any, r: Quotation) => r.opportunity?.opportunityNo || '-',
    },
    {
      title: '金额',
      key: 'totalAmount',
      width: 150,
      render: (_: any, r: Quotation) => formatMoney(r.totalAmount, r.currency),
    },
    {
      title: '折合 CNY',
      key: 'totalAmountCny',
      width: 130,
      render: (_: any, r: Quotation) => formatMoney(r.totalAmountCny, 'CNY'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (s: QuotationStatus) => (
        <Tag color={QUOTATION_STATUS_COLOR[s]}>{QUOTATION_STATUS_TEXT[s] || s}</Tag>
      ),
    },
    {
      title: '有效期至',
      dataIndex: 'validUntil',
      width: 120,
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (_: any, r: Quotation) => (
        <Space size={4}>
          <Tooltip title="详情">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r.id)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Popconfirm title="确认删除该报价？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
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
            <Statistic title="报价单数" value={stats.count} suffix="单" />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless">
            <Statistic title="本页金额合计（CNY）" value={stats.amount} precision={2} />
          </Card>
        </Col>
      </Row>

      <Card
        variant="borderless"
        title="报价管理"
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
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建报价
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
        title={`报价详情${detail ? ` · ${detail.quotationNo}` : ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={880}
      >
        {detailLoading && <div>加载中…</div>}
        {!detailLoading && detail && (
          <div>
            <Row gutter={16}>
              <Col span={12}>标题：{detail.title}</Col>
              <Col span={12}>版本：v{detail.version}</Col>
              <Col span={12}>客户：{detail.customer?.companyName || '-'}</Col>
              <Col span={12}>商机：{detail.opportunity?.opportunityNo || '-'}</Col>
              <Col span={12}>金额：{formatMoney(detail.totalAmount, detail.currency)}</Col>
              <Col span={12}>折合 CNY：{formatMoney(detail.totalAmountCny, 'CNY')}</Col>
              <Col span={12}>
                状态：
                <Tag color={QUOTATION_STATUS_COLOR[detail.status]}>
                  {QUOTATION_STATUS_TEXT[detail.status] || detail.status}
                </Tag>
              </Col>
              <Col span={12}>
                有效期至：{detail.validUntil ? dayjs(detail.validUntil).format('YYYY-MM-DD') : '-'}
              </Col>
              <Col span={12}>贸易条款：{detail.tradeTerms || '-'}</Col>
              <Col span={12}>付款条款：{detail.paymentTerms || '-'}</Col>
              <Col span={12}>交期（天）：{detail.leadTime ?? '-'}</Col>
              <Col span={12}>起运港：{detail.portOfLoading || '-'}</Col>
              {detail.notes && <Col span={24}>备注：{detail.notes}</Col>}
            </Row>

            <Table
              style={{ marginTop: 16 }}
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={detail.items || []}
              columns={[
                { title: '产品', dataIndex: 'productName' },
                { title: '规格', dataIndex: 'spec', render: (v?: string) => v || '-' },
                { title: '数量', dataIndex: 'quantity', render: (v: string) => num(v) ?? '-' },
                { title: '单价', dataIndex: 'unitPrice', render: (v: string) => formatMoney(v, detail.currency) },
                { title: '金额', dataIndex: 'amount', render: (v: string) => formatMoney(v, detail.currency) },
              ]}
            />
          </div>
        )}
      </Modal>

      {/* 新建 / 编辑 */}
      <Modal
        title={editing ? `编辑报价 · ${editing.quotationNo}` : '新建报价'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        width={840}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ currency: 'USD', status: 'DRAFT' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="opportunityId" label="商机" rules={[{ required: true, message: '请选择商机' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择商机（报价必须归属商机）"
                  options={opportunityOptions}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="title" label="报价标题" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="如：初版报价 / Revised Quote" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="currency" label="币种">
                <Select options={CURRENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="totalAmount"
                label="报价金额"
                extra="留空则按明细汇总"
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={STATUS_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="validUntil" label="有效期至">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="leadTime" label="交期（天）">
                <InputNumber style={{ width: '100%' }} min={0} precision={0} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="portOfLoading" label="起运港">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tradeTerms" label="贸易条款">
                <Input placeholder="如 FOB / CIF" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="paymentTerms" label="付款条款">
                <Input placeholder="如 30% T/T" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item label="明细">
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

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default QuotePage;
