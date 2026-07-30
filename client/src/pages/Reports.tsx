import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, Typography } from 'antd';
import {
  TeamOutlined, ShoppingCartOutlined, FireOutlined, RiseOutlined,
  UserOutlined, AimOutlined, ExperimentOutlined,
  FileDoneOutlined, PercentageOutlined, DollarOutlined,
} from '@ant-design/icons';
import { customerApi } from '../api/customers';
import { orderApi } from '../api/customers';

const { Text, Title } = Typography;

interface ReportStats {
  leadCount: number;
  opportunityCount: number;
  sampleCount: number;
  pipelineOrderCount: number;
  newCustomerCount: number;
  oldCustomerCount: number;
  newCustomerAmount: number;
  oldCustomerAmount: number;
  leadToOpportunity: number;
  opportunityToNext: number;
  sampleToOrder: number;
  leadToOrder: number;
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportStats | null>(null);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);
  const [topCustomers, setTopCustomers] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [reportRes, orderRes] = await Promise.all([
          customerApi.report(),
          orderApi.list({ pageSize: 10 }),
        ]);
        setReport(reportRes.data.data);
        const orderData = orderRes.data.data;
        setRecentOrders(orderData.list || []);

        const customerAmounts: Record<string, { companyName: string; total: number; count: number }> = {};
        for (const o of orderData.list || []) {
          const name = o.customer?.companyName || 'Unknown';
          if (!customerAmounts[name]) {
            customerAmounts[name] = { companyName: name, total: 0, count: 0 };
          }
          customerAmounts[name].total += o.amountCNY || 0;
          customerAmounts[name].count += 1;
        }
        setTopCustomers(
          Object.values(customerAmounts)
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
        );
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>;

  const stats = report || {
    leadCount: 0, opportunityCount: 0, sampleCount: 0, pipelineOrderCount: 0,
    newCustomerCount: 0, oldCustomerCount: 0,
    newCustomerAmount: 0, oldCustomerAmount: 0,
    leadToOpportunity: 0, opportunityToNext: 0, sampleToOrder: 0, leadToOrder: 0,
  };

  const fmtCNY = (v: number) => {
    if (v >= 10000) return `¥${(v / 10000).toFixed(1)}万`;
    return `¥${v.toLocaleString()}`;
  };

  const cardStyle = (color: string): React.CSSProperties => ({
    borderTop: `3px solid ${color}`,
    height: '100%',
  });

  const statCards = [
    // 第一行
    { title: '线索量', value: stats.leadCount, color: '#1677ff', icon: <UserOutlined /> },
    { title: '商机量', value: stats.opportunityCount, color: '#52c41a', icon: <AimOutlined /> },
    { title: '样品单数', value: stats.sampleCount, color: '#fa8c16', icon: <ExperimentOutlined /> },
    { title: '订单数', value: stats.pipelineOrderCount, color: '#f5222d', icon: <FileDoneOutlined /> },
    // 第二行
    { title: '老客户数', value: stats.oldCustomerCount, color: '#13c2c2', icon: <TeamOutlined /> },
    { title: '老客户订单金额', value: fmtCNY(stats.oldCustomerAmount), color: '#2f54eb', icon: <DollarOutlined /> },
    { title: '新客户数', value: stats.newCustomerCount, color: '#722ed1', icon: <FireOutlined /> },
    { title: '新客户成交金额', value: fmtCNY(stats.newCustomerAmount), color: '#eb2f96', icon: <DollarOutlined /> },
    // 第三行
    { title: '线索→商机转化率', value: stats.leadToOpportunity, color: '#faad14', icon: <PercentageOutlined />, suffix: '%' },
    { title: '商机→样品/订单转化率', value: stats.opportunityToNext, color: '#fa541c', icon: <RiseOutlined />, suffix: '%' },
    { title: '样品→订单转化率', value: stats.sampleToOrder, color: '#a0d911', icon: <ShoppingCartOutlined />, suffix: '%' },
    { title: '综合转化率（线索→订单）', value: stats.leadToOrder, color: '#1677ff', icon: <RiseOutlined />, suffix: '%' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>业务报告</Title>

      {[0, 4, 8].map((start, rowIdx) => (
        <Row key={rowIdx} gutter={16} style={{ marginBottom: 16 }} align="stretch">
          {statCards.slice(start, start + 4).map((item) => (
            <Col span={6} key={`${rowIdx}-${item.title}`}>
              <Card size="small" style={cardStyle(item.color)}>
                <Statistic
                  title={
                    <span style={{ color: '#666', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: item.color }}>{item.icon}</span>
                      {item.title}
                    </span>
                  }
                  value={item.value}
                  valueStyle={{
                    fontSize: 24,
                    fontWeight: 700,
                    color: '#1f2937',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  suffix={item.suffix ? <span style={{ fontSize: 16, color: '#999' }}>{item.suffix}</span> : undefined}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ))}

      <Row gutter={16}>
        <Col span={12}>
          <Card size="small" title={<span><ShoppingCartOutlined /> 近期订单</span>}>
            <Table
              dataSource={recentOrders}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ y: 340 }}
              columns={[
                { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 120, render: (v: string) => v || '-' },
                { title: '客户', key: 'customer', width: 140, render: (_: any, r: any) => r.customer?.companyName || '-' },
                { title: '金额(CNY)', dataIndex: 'amountCNY', key: 'amountCNY', width: 110, align: 'right' as const,
                  render: (v: number) => v != null ? `¥${v.toLocaleString()}` : '-' },
                { title: '日期', dataIndex: 'orderDate', key: 'orderDate', width: 100, render: (v: string) => v || '-' },
                { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (v: string) => <Tag>{v || '-'}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<span><RiseOutlined /> Top 下单客户</span>}>
            <Table
              dataSource={topCustomers}
              rowKey="companyName"
              size="small"
              pagination={false}
              scroll={{ y: 340 }}
              columns={[
                { title: '客户', dataIndex: 'companyName', key: 'companyName', render: (v: string) => <Text strong>{v}</Text> },
                { title: '订单数', dataIndex: 'count', key: 'count', width: 70, align: 'center' as const },
                { title: '累计金额', dataIndex: 'total', key: 'total', width: 120, align: 'right' as const,
                  render: (v: number) => <Text strong>¥{v.toLocaleString()}</Text> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
