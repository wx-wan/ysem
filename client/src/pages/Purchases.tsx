import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Statistic, Row, Col,
  Modal, Descriptions, Empty, Tooltip, theme,
} from 'antd';
import { PlusOutlined, SearchOutlined, EyeOutlined, EditOutlined, DeleteOutlined, InboxOutlined } from '@ant-design/icons';
import {
  purchaseApi,
  PURCHASE_ITEM_STATUS_TEXT,
  PURCHASE_STATUS_COLOR,
  PURCHASE_STATUS_TEXT,
  PURCHASE_TYPE_TEXT,
  type PurchaseOrder,
  type PurchaseOrderItem,
  type PurchaseStatus,
  type PurchaseType,
} from '../api/purchases';
import PurchaseFormModal from '../components/purchase/PurchaseFormModal';
import dayjs from 'dayjs';

/**
 * V1.0 采购单管理页（PurchaseOrder）
 *
 * 数据源：/api/purchase-orders（V1.0 controller），编号 PR-yyyyMMdd-0001。
 * 本页已脱离 legacy 采购单据端点，采购单 CRUD 全部走 V1.0。
 *
 * 语义要点：
 *  - 明细为 `PurchaseOrderItem[]`（不再有 JSON 明细，也不再有 legacy 本位币冗余字段）；
 *  - 金额由服务端权威计算：列表展示 `totalAmount`（原币）+ `totalAmountCny`（本位币，可 null）；
 *  - 状态为只读展示（V1.0 无 status / arrival 专用端点 → 状态流转与到货流程 DEFERRED）；
 *  - DELETE 由后端 FK 约束兜底（存在 Payment 引用 → 409）。
 */

/** Decimal（JSON string）/ number → number；null / '' / 非数字 → null（不用 0 掩盖缺失值） */
const toNum = (v?: string | number | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/** 原币金额展示：null → '-'（不做 0 兜底） */
const money = (v?: string | number | null, currency?: string | null): string => {
  const n = toNum(v);
  if (n === null) return '-';
  return `${currency ? `${currency} ` : ''}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const dateText = (v?: string | null): string => (v ? dayjs(v).format('YYYY-MM-DD') : '-');

const CURRENCY_OPTIONS = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD'].map((v) => ({ label: v, value: v }));

const PurchasesPage: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [list, setList] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | undefined>(undefined);
  const [typeFilter, setTypeFilter] = useState<PurchaseType | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await purchaseApi.list({
        page,
        pageSize,
        keyword: keyword || undefined,
        status: statusFilter,
        purchaseType: typeFilter,
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
  }, [page, pageSize, keyword, statusFilter, typeFilter]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (o: PurchaseOrder) => {
    setEditing(o);
    setModalOpen(true);
  };

  const openDetail = async (o: PurchaseOrder) => {
    try {
      const res = await purchaseApi.get(o.id);
      setDetail(res.data?.data || o);
    } catch {
      setDetail(o);
    }
  };

  const handleDelete = async (o: PurchaseOrder) => {
    try {
      await purchaseApi.remove(o.id);
      message.success('删除成功');
      fetchList();
    } catch (e: any) {
      // 409：存在 Payment 等下游单据引用（后端 FK Restrict 兜底）
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  /** 本页统计（仅当前页数据，不冒充全量） */
  const pageStats = useMemo(() => {
    const cny = list.reduce((s, o) => s + (toNum(o.totalAmountCny) ?? 0), 0);
    const cnyCount = list.filter((o) => toNum(o.totalAmountCny) !== null).length;
    const pending = list.filter((o) => o.status === 'ORDERED' || o.status === 'PARTIAL').length;
    return { count: list.length, cny, cnyCount, pending };
  }, [list]);

  const columns = [
    {
      title: '采购单号',
      dataIndex: 'purchaseNo',
      key: 'purchaseNo',
      width: 190,
      render: (v: string, o: PurchaseOrder) => (
        <a onClick={() => openDetail(o)} style={{ fontWeight: 500 }}>
          {v || '-'}
        </a>
      ),
    },
    {
      title: '供应商',
      key: 'supplier',
      width: 180,
      render: (_: unknown, o: PurchaseOrder) => o.supplier?.name || '-',
    },
    {
      title: '采购日期',
      dataIndex: 'purchaseDate',
      key: 'purchaseDate',
      width: 110,
      render: (v?: string | null) => dateText(v),
    },
    {
      title: '采购类型',
      dataIndex: 'purchaseType',
      key: 'purchaseType',
      width: 110,
      render: (t: PurchaseType) => PURCHASE_TYPE_TEXT[t] || t,
    },
    {
      title: '明细',
      key: 'items',
      width: 70,
      render: (_: unknown, o: PurchaseOrder) => (o.items || []).length || 0,
    },
    {
      title: '原币金额',
      key: 'totalAmount',
      width: 140,
      render: (_: unknown, o: PurchaseOrder) => money(o.totalAmount, o.currency),
    },
    {
      title: '折合 CNY',
      key: 'totalAmountCny',
      width: 130,
      render: (_: unknown, o: PurchaseOrder) => money(o.totalAmountCny, 'CNY'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: PurchaseStatus) => (
        <Tag color={PURCHASE_STATUS_COLOR[v]}>{PURCHASE_STATUS_TEXT[v] || v}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_: unknown, o: PurchaseOrder) => (
        <Space size={2}>
          <Tooltip title="详情">
            <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(o)} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(o)} />
          </Tooltip>
          <Popconfirm title="确定删除该采购单？" onConfirm={() => handleDelete(o)} okText="删除" cancelText="取消">
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const detailItems: PurchaseOrderItem[] = detail?.items || [];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 统计卡（本页口径） */}
      <Row gutter={16}>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="采购单总数"
              value={total}
              prefix={<InboxOutlined style={{ color: token.colorPrimary }} />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic title="本页单据数" value={pageStats.count} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic title="本页待入库（已下单/部分到货）" value={pageStats.pending} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title={
                <Tooltip title={`本页 ${pageStats.count} 条中，已折算 ${pageStats.cnyCount} 条；未折算（缺汇率）不计入`}>
                  <span>本页折合金额（CNY）</span>
                </Tooltip>
              }
              value={pageStats.cny}
              precision={2}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" style={{ borderRadius: 12 }}>
        <Space wrap>
          <Input
            placeholder="搜索单号 / 供应商 / 备注"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            allowClear
            style={{ width: 240 }}
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            options={(Object.keys(PURCHASE_STATUS_TEXT) as PurchaseStatus[]).map((k) => ({
              label: PURCHASE_STATUS_TEXT[k],
              value: k,
            }))}
          />
          <Select
            placeholder="采购类型"
            allowClear
            style={{ width: 150 }}
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v);
              setPage(1);
            }}
            options={(Object.keys(PURCHASE_TYPE_TEXT) as PurchaseType[]).map((k) => ({
              label: PURCHASE_TYPE_TEXT[k],
              value: k,
            }))}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建采购单
          </Button>
        </Space>
      </Card>

      {/* 表格 */}
      <Card size="small" style={{ borderRadius: 12 }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={list}
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无采购单" /> }}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
        />
      </Card>

      {/* 新建/编辑 */}
      <PurchaseFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSuccess={fetchList}
      />

      {/* 详情 */}
      <Modal
        title={`采购单详情${detail?.purchaseNo ? ' · ' + detail.purchaseNo : ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        width={880}
      >
        {detail && (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="供应商">{detail.supplier?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="采购日期">{dateText(detail.purchaseDate)}</Descriptions.Item>
              <Descriptions.Item label="采购类型">{PURCHASE_TYPE_TEXT[detail.purchaseType] || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={PURCHASE_STATUS_COLOR[detail.status]}>{PURCHASE_STATUS_TEXT[detail.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="币种">{detail.currency || '-'}</Descriptions.Item>
              <Descriptions.Item label="原币金额">{money(detail.totalAmount, detail.currency)}</Descriptions.Item>
              <Descriptions.Item label="折合 CNY">{money(detail.totalAmountCny, 'CNY')}</Descriptions.Item>
              <Descriptions.Item label="预计到货">{dateText(detail.expectedArrivalAt)}</Descriptions.Item>
              <Descriptions.Item label="实际到货">{dateText(detail.arrivedAt)}</Descriptions.Item>
              <Descriptions.Item label="销售订单">{detail.salesOrder?.orderNo || '-'}</Descriptions.Item>
              <Descriptions.Item label="生产工单">{detail.productionOrder?.productionNo || '-'}</Descriptions.Item>
              <Descriptions.Item label="创建时间">
                {detail.createdAt ? dayjs(detail.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
              </Descriptions.Item>
            </Descriptions>

            <Table
              size="small"
              rowKey={(r) => r.id}
              dataSource={detailItems}
              pagination={false}
              locale={{ emptyText: '暂无明细' }}
              scroll={{ x: 860 }}
              columns={[
                { title: '行', dataIndex: 'lineNo', width: 50 },
                { title: '产品名称', dataIndex: 'itemName', render: (v: string) => v || '-' },
                { title: '规格', dataIndex: 'spec', width: 110, render: (v?: string | null) => v || '-' },
                { title: '数量', dataIndex: 'quantity', width: 90, render: (v: string) => toNum(v) ?? '-' },
                { title: '单位', dataIndex: 'unit', width: 70, render: (v?: string) => v || '-' },
                {
                  title: '单价',
                  dataIndex: 'unitPrice',
                  width: 110,
                  render: (v: string) => money(v, detail.currency),
                },
                { title: '金额', dataIndex: 'amount', width: 120, render: (v: string) => money(v, detail.currency) },
                {
                  title: '已到货',
                  dataIndex: 'arrivedQty',
                  width: 90,
                  render: (v: string) => toNum(v) ?? '-',
                },
                {
                  title: '行状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (s: PurchaseOrderItem['status']) => PURCHASE_ITEM_STATUS_TEXT[s] || s,
                },
              ]}
            />

            <Row justify="end" style={{ marginTop: 12 }}>
              <Space size={24}>
                <Space size={8}>
                  <span style={{ color: '#8c8c8c' }}>原币合计</span>
                  <span style={{ fontSize: 16, fontWeight: 600, color: token.colorPrimary }}>
                    {money(detail.totalAmount, detail.currency)}
                  </span>
                </Space>
                <Space size={8}>
                  <span style={{ color: '#8c8c8c' }}>折合 CNY</span>
                  <span style={{ fontSize: 16, fontWeight: 600 }}>{money(detail.totalAmountCny, 'CNY')}</span>
                </Space>
              </Space>
            </Row>

            {detail.remark && (
              <div style={{ marginTop: 12, fontSize: 13, color: token.colorTextSecondary }}>
                备注：{detail.remark}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default PurchasesPage;
