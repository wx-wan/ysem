import React, { useEffect, useState } from 'react';
import { Table, Button, Input, Space, Tag, Card, Row, Col, Statistic, Typography, Tooltip } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import { paymentApi, profitApi, PaymentRecord, ProfitRecord } from '../api/customers';
import SegmentedTabBar from '../components/common/SegmentedTabBar';
import dayjs from 'dayjs';

const { Title } = Typography;

type TabKey = 'payment' | 'profit';

export default function SettlementPage() {
  const [tab, setTab] = useState<TabKey>('payment');
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [profits, setProfits] = useState<ProfitRecord[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      if (tab === 'payment') {
        const res = await paymentApi.list({ keyword: keyword || undefined });
        setPayments(res.data?.data || []);
      } else {
        const res = await profitApi.list({ keyword: keyword || undefined });
        setProfits(res.data?.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const paymentColumns = [
    { title: '付款单号', dataIndex: 'paymentNo', render: (t: string, r: PaymentRecord) => t || r.id.slice(0, 8) },
    { title: '关联单据', dataIndex: ['order', 'orderNo'], render: (_: any, r: PaymentRecord) => r.order?.orderNo || r.order?.title || '-' },
    { title: '客户', dataIndex: ['customer', 'companyName'], render: (_: any, r: PaymentRecord) => r.customer?.companyName || '-' },
    { title: '收款日期', dataIndex: 'payDate', render: (t: string) => (t ? dayjs(t).format('YYYY-MM-DD') : '-') },
    { title: '收款金额', dataIndex: 'amount', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '收款比例', dataIndex: 'ratio', render: (v: number) => (v != null ? `${v}%` : '-') },
    { title: '方式', dataIndex: 'method', render: (t: string) => (t || '-') },
    { title: '状态', dataIndex: 'status', render: (t: string) => (
      <Tag color={t === 'RECEIVED' ? 'success' : 'processing'}>{t === 'RECEIVED' ? '已收' : '待收'}</Tag>
    ) },
  ];

  const profitColumns = [
    { title: '利润单号', dataIndex: 'profitNo', render: (t: string, r: ProfitRecord) => t || r.id.slice(0, 8) },
    { title: '关联单据', dataIndex: ['order', 'orderNo'], render: (_: any, r: ProfitRecord) => r.order?.orderNo || r.order?.title || '-' },
    { title: '客户', dataIndex: ['customer', 'companyName'], render: (_: any, r: ProfitRecord) => r.customer?.companyName || '-' },
    { title: '收入', dataIndex: 'revenue', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '成本', dataIndex: 'cost', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '利润', dataIndex: 'profit', render: (v: number) => (v != null ? `CNY ${v.toFixed(2)}` : '-') },
    { title: '利润率', dataIndex: 'margin', render: (v: number) => (v != null ? `${v.toFixed(1)}%` : '-') },
  ];

  const totalAmount = tab === 'payment'
    ? payments.reduce((s, p) => s + (p.amount || 0), 0)
    : profits.reduce((s, p) => s + (p.profit || 0), 0);

  return (
    <div className="settlement-page">
      <div className="orders-toolbar">
        <Title level={4} style={{ margin: 0 }}>结算管理</Title>
        <SegmentedTabBar
          options={[
            { label: '付款单', key: 'payment' },
            { label: '利润单', key: 'profit' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as TabKey)}
        />
        <Space>
          <Input
            allowClear
            placeholder={tab === 'payment' ? '搜索付款单/客户' : '搜索利润单/客户'}
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onBlur={load}
            onPressEnter={load}
            style={{ width: 220 }}
          />
          <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
        </Space>
      </div>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title={tab === 'payment' ? '收款总额' : '利润总额'}
              value={totalAmount}
              precision={2}
              prefix="CNY"
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title={tab === 'payment' ? '付款单数' : '利润单数'} value={tab === 'payment' ? payments.length : profits.length} />
          </Card>
        </Col>
      </Row>

      <Table
        rowKey="id"
        loading={loading}
        columns={tab === 'payment' ? paymentColumns : profitColumns}
        dataSource={tab === 'payment' ? payments : profits}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />
    </div>
  );
}
