import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Col, Descriptions, Input, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PAYMENT_DIRECTION_COLOR,
  PAYMENT_DIRECTION_TEXT,
  PAYMENT_STATUS_COLOR,
  PAYMENT_STATUS_TEXT,
  PAYMENT_TYPE_TEXT,
  paymentApi,
  type Payment,
  type PaymentStatus,
} from '../api/payments';
import {
  PROFIT_STATUS_COLOR,
  PROFIT_STATUS_TEXT,
  profitApi,
  type Profit,
} from '../api/profits';
import SegmentedTabBar from '../components/common/SegmentedTabBar';
import { buildTablePagination } from '../components/common/tablePagination';

/**
 * V1.0 结算管理页（Payment / Profit）
 *
 * 数据源：/api/payments、/api/profits（V1.0 controller）。
 * 本页已脱离 legacy 统一订单接口，不再经由 Order 体系间接访问结算数据。
 *
 * 语义要点：
 *  - Payment 宿主 exactly-one：IN→SalesOrder（收款）/ OUT→PurchaseOrder（付款）；无 ownerId，scope 经宿主继承；
 *  - Payment.customerId 为辅助字段：仅 IN 有值，OUT 必须为 NULL；
 *  - Payment.amount = 原币，Payment.amountCny = 本位币（可 NULL，缺汇率时不折算）；
 *  - 仅 direction=IN 且 status=CONFIRMED 的 Payment 参与 SalesOrder.paidAmountCny（服务端重算）；
 *  - Profit 与 SalesOrder 1:1，自身无 customer，客户经 salesOrder.customer；
 *  - Profit.freightCostCny 由 Σ Shipment.freightAmountCny 服务端聚合，只读；
 *  - 本页为纯只读列表（无 create / edit / delete）。
 */

/** Decimal（JSON string）→ number；null / '' / 非数字 → null（不得用 0 掩盖缺失汇率） */
const toNum = (v?: string | number | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/** 金额展示：null → '-'（原币与本位币分别传入 currency） */
const money = (v?: string | number | null, currency?: string | null): string => {
  const n = toNum(v);
  if (n === null) return '-';
  return `${currency ? `${currency} ` : ''}${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

/** 百分数（ratio / margin 均为百分数语义） */
const percent = (v?: string | number | null): string => {
  const n = toNum(v);
  return n === null ? '-' : `${n.toFixed(2)}%`;
};

const dateText = (v?: string | null): string => (v ? dayjs(v).format('YYYY-MM-DD') : '-');

type TabKey = 'payment' | 'profit';

export default function SettlementPage() {
  const [tab, setTab] = useState<TabKey>('payment');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [profits, setProfits] = useState<Profit[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keywordInput, setKeywordInput] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'payment') {
        const res = await paymentApi.list({
          keyword: keyword || undefined,
          page,
          pageSize,
        });
        const d = res.data?.data;
        setPayments(d?.list || []);
        setTotal(d?.total || 0);
      } else {
        const res = await profitApi.list({
          keyword: keyword || undefined,
          page,
          pageSize,
        });
        const d = res.data?.data;
        setProfits(d?.list || []);
        setTotal(d?.total || 0);
      }
    } catch {
      // 错误提示由请求拦截器统一处理
    } finally {
      setLoading(false);
    }
  }, [tab, keyword, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  const submitSearch = () => {
    setKeyword(keywordInput);
    setPage(1);
  };

  /** Payment：宿主单据（IN→销售订单号 / OUT→采购单号） */
  const paymentOwnerText = (r: Payment): string => {
    if (r.direction === 'IN') return r.salesOrder?.orderNo || '-';
    return r.purchaseOrder?.purchaseNo || '-';
  };

  const paymentColumns: ColumnsType<Payment> = [
    {
      title: '收付款单号',
      dataIndex: 'paymentNo',
      width: 180,
      render: (t: string, r: Payment) => t || r.id.slice(0, 8),
    },
    {
      title: '方向',
      dataIndex: 'direction',
      width: 80,
      render: (d: Payment['direction']) => (
        <Tag color={PAYMENT_DIRECTION_COLOR[d]}>{PAYMENT_DIRECTION_TEXT[d] || d}</Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (t: Payment['type']) => PAYMENT_TYPE_TEXT[t] || t,
    },
    {
      title: '关联单据',
      key: 'owner',
      width: 180,
      render: (_: unknown, r: Payment) => (
        <Space size={4}>
          <Tag color={PAYMENT_DIRECTION_COLOR[r.direction]} style={{ marginInlineEnd: 0 }}>
            {PAYMENT_DIRECTION_TEXT[r.direction]}
          </Tag>
          <span>{paymentOwnerText(r)}</span>
        </Space>
      ),
    },
    {
      title: '客户',
      key: 'customer',
      width: 170,
      // 客户为辅助字段：仅 IN 有值；OUT 必为 NULL，不得猜测客户
      render: (_: unknown, r: Payment) =>
        r.direction === 'IN' ? r.customer?.companyName || '-' : '-',
    },
    {
      title: '业务日期',
      dataIndex: 'payDate',
      width: 110,
      render: (v?: string) => dateText(v),
    },
    {
      title: '原币金额',
      key: 'amount',
      width: 140,
      render: (_: unknown, r: Payment) => money(r.amount, r.currency),
    },
    {
      title: '本位币金额（CNY）',
      key: 'amountCny',
      width: 150,
      render: (_: unknown, r: Payment) => money(r.amountCny, 'CNY'),
    },
    {
      title: '比例',
      dataIndex: 'ratio',
      width: 90,
      render: (v?: string | null) => percent(v),
    },
    {
      title: '方式',
      dataIndex: 'method',
      width: 110,
      render: (v?: string | null) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: PaymentStatus) => (
        <Tooltip
          title={
            s === 'CONFIRMED'
              ? '已确认：IN 方向将计入销售订单已收（服务端重算）'
              : '仅「已确认」的收款才计入销售订单已收'
          }
        >
          <Tag color={PAYMENT_STATUS_COLOR[s]}>{PAYMENT_STATUS_TEXT[s] || s}</Tag>
        </Tooltip>
      ),
    },
  ];

  const profitColumns: ColumnsType<Profit> = [
    {
      title: '利润单号',
      dataIndex: 'profitNo',
      width: 180,
      render: (t: string, r: Profit) => t || r.id.slice(0, 8),
    },
    {
      title: '来源订单',
      key: 'salesOrder',
      width: 170,
      render: (_: unknown, r: Profit) => r.salesOrder?.orderNo || '-',
    },
    {
      title: '客户',
      key: 'customer',
      width: 170,
      // Profit 自身无 customer 字段 —— 客户必须经 salesOrder.customer 取得
      render: (_: unknown, r: Profit) => r.salesOrder?.customer?.companyName || '-',
    },
    {
      title: '收入（CNY）',
      key: 'revenueCny',
      width: 130,
      render: (_: unknown, r: Profit) => money(r.revenueCny, 'CNY'),
    },
    {
      title: '总成本（CNY）',
      key: 'totalCostCny',
      width: 130,
      render: (_: unknown, r: Profit) => money(r.totalCostCny, 'CNY'),
    },
    {
      title: '利润（CNY）',
      key: 'profitCny',
      width: 130,
      render: (_: unknown, r: Profit) => money(r.profitCny, 'CNY'),
    },
    {
      title: '利润率',
      dataIndex: 'margin',
      width: 90,
      render: (v?: string | null) => percent(v),
    },
    {
      title: '运费（CNY）',
      key: 'freightCostCny',
      width: 120,
      render: (_: unknown, r: Profit) => (
        <Tooltip title="来源：Σ Shipment.freightAmountCny（服务端聚合，只读）">
          <span>{money(r.freightCostCny, 'CNY')}</span>
        </Tooltip>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (s: Profit['status']) => (
        <Tag color={PROFIT_STATUS_COLOR[s]}>{PROFIT_STATUS_TEXT[s] || s}</Tag>
      ),
    },
  ];

  /** 本页合计：Payment 为原币口径（多币种未折算），Profit 为本位币口径 */
  const pageTotal = useMemo(() => {
    if (tab === 'payment') {
      return payments.reduce((s, p) => s + (toNum(p.amount) ?? 0), 0);
    }
    return profits.reduce((s, p) => s + (toNum(p.profitCny) ?? 0), 0);
  }, [tab, payments, profits]);

  const currentCount = (tab === 'payment' ? payments : profits).length;

  const paginationConfig = buildTablePagination({
    total,
    page,
    pageSize,
    onChange: (p, ps) => {
      setPage(p);
      setPageSize(ps);
    },
  });

  const paymentExpand = (r: Payment) => (
    <Descriptions size="small" column={3} styles={{ label: { width: 110 } }}>
      <Descriptions.Item label="汇率">
        {toNum(r.exchangeRate) === null ? '缺失（未折算本位币）' : `${r.exchangeRate}（1 ${r.currency} = X CNY）`}
      </Descriptions.Item>
      <Descriptions.Item label="银行账户">{r.bankAccount || '-'}</Descriptions.Item>
      <Descriptions.Item label="凭证说明">{r.voucherRemark || '-'}</Descriptions.Item>
      <Descriptions.Item label="确认时间">
        {r.confirmedAt ? dayjs(r.confirmedAt).format('YYYY-MM-DD HH:mm') : '-'}
      </Descriptions.Item>
      <Descriptions.Item label="确认人">{r.confirmedBy || '-'}</Descriptions.Item>
      <Descriptions.Item label="创建时间">
        {r.createdAt ? dayjs(r.createdAt).format('YYYY-MM-DD HH:mm') : '-'}
      </Descriptions.Item>
      <Descriptions.Item label="备注" span={3}>
        {r.remark || '-'}
      </Descriptions.Item>
    </Descriptions>
  );

  const profitExpand = (r: Profit) => (
    <Descriptions size="small" column={3} styles={{ label: { width: 120 } }}>
      <Descriptions.Item label="原币收入">
        {money(r.revenue, r.currency)}
      </Descriptions.Item>
      <Descriptions.Item label="汇率">
        {toNum(r.exchangeRate) === null ? '缺失' : r.exchangeRate}
      </Descriptions.Item>
      <Descriptions.Item label="计算时间">
        {r.calculatedAt ? dayjs(r.calculatedAt).format('YYYY-MM-DD HH:mm') : '-'}
      </Descriptions.Item>
      <Descriptions.Item label="原辅料（CNY）">{money(r.materialCostCny, 'CNY')}</Descriptions.Item>
      <Descriptions.Item label="外发加工（CNY）">{money(r.outsourceCostCny, 'CNY')}</Descriptions.Item>
      <Descriptions.Item label="包材（CNY）">{money(r.packagingCostCny, 'CNY')}</Descriptions.Item>
      <Descriptions.Item label="内部人工（CNY）">{money(r.laborCostCny, 'CNY')}</Descriptions.Item>
      <Descriptions.Item label="运费（CNY）">
        <Tooltip title="来源：Σ Shipment.freightAmountCny（服务端聚合，只读）">
          <span>{money(r.freightCostCny, 'CNY')}</span>
        </Tooltip>
      </Descriptions.Item>
      <Descriptions.Item label="其他（CNY）">{money(r.otherCostCny, 'CNY')}</Descriptions.Item>
      <Descriptions.Item label="备注" span={3}>
        {r.remark || '-'}
      </Descriptions.Item>
    </Descriptions>
  );

  return (
    <div className="settlement-page">
      <div className="orders-toolbar">
        <Typography.Title level={4} style={{ margin: 0 }}>
          结算管理
        </Typography.Title>
        <SegmentedTabBar
          options={[
            { label: '收付款单', key: 'payment' },
            { label: '利润单', key: 'profit' },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v as TabKey);
            setPage(1);
          }}
        />
        <Space>
          <Input
            allowClear
            placeholder="搜索单号"
            prefix={<SearchOutlined />}
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onPressEnter={submitSearch}
            onBlur={submitSearch}
            style={{ width: 220 }}
          />
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="单据总数" value={total} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="本页单据数" value={currentCount} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title={
                tab === 'payment' ? (
                  <Tooltip title="原币口径；多币种直接相加未做汇率折算，仅供概览">
                    <span>本页付款合计（原币）</span>
                  </Tooltip>
                ) : (
                  '本页利润合计（CNY）'
                )
              }
              value={pageTotal}
              precision={2}
              prefix={tab === 'payment' ? undefined : 'CNY'}
            />
          </Card>
        </Col>
      </Row>

      {tab === 'payment' ? (
        <Table<Payment>
          rowKey="id"
          loading={loading}
          columns={paymentColumns}
          dataSource={payments}
          scroll={{ x: 1500 }}
          expandable={{ expandedRowRender: (r) => paymentExpand(r) }}
          pagination={paginationConfig}
        />
      ) : (
        <Table<Profit>
          rowKey="id"
          loading={loading}
          columns={profitColumns}
          dataSource={profits}
          scroll={{ x: 1400 }}
          expandable={{ expandedRowRender: (r) => profitExpand(r) }}
          pagination={paginationConfig}
        />
      )}
    </div>
  );
}
