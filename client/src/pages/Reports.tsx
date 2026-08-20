import { useEffect, useState } from 'react';
import { Row, Col, Card, Statistic, Table, Tag, Spin, Typography, theme, Space } from 'antd';
import { useCardGutter } from '../components/common/tokens';
import {
  TeamOutlined, ShoppingCartOutlined, FireOutlined, RiseOutlined,
  UserOutlined, AimOutlined, ExperimentOutlined,
  FileDoneOutlined, PercentageOutlined, DollarOutlined,
} from '@ant-design/icons';
import { customerApi } from '../api/customers';
import { orderApi } from '../api/customers';
import Price from '../components/common/Price';

const { Text, Title } = Typography;

interface ReportStats {
  leadCount: number;
  opportunityCount: number;
  sampleOrderCount: number;
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
  const cardGutter = useCardGutter();
  const { token } = theme.useToken();
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
    leadCount: 0, opportunityCount: 0, sampleOrderCount: 0, pipelineOrderCount: 0,
    newCustomerCount: 0, oldCustomerCount: 0,
    newCustomerAmount: 0, oldCustomerAmount: 0,
    leadToOpportunity: 0, opportunityToNext: 0, sampleToOrder: 0, leadToOrder: 0,
  };


  // 语义调色板：收敛 12 种随机 hex → 统一的语义分组色（配色锁）
  const C = {
    primary: token.colorPrimary,   // 线索
    success: token.colorSuccess,   // 商机/订单
    warning: token.colorWarning,   // 样品/转化率
    error: token.colorError,       // 订单数强调
    info: token.colorInfo,         // 新客户
    purple: token.purple6,         // 新客户金额
  };

  const cardStyle = (color: string): React.CSSProperties => ({
    borderTop: `3px solid ${color}`,
    borderRadius: 16,
    height: '100%',
  });

  const statCards = [
    // 第一行
    { title: '线索量', value: stats.leadCount, color: C.primary, icon: <UserOutlined /> },
    { title: '商机量', value: stats.opportunityCount, color: C.success, icon: <AimOutlined /> },
    { title: '下打样单数', value: stats.sampleOrderCount, color: C.warning, icon: <ExperimentOutlined /> },
    { title: '订单数', value: stats.pipelineOrderCount, color: C.error, icon: <FileDoneOutlined /> },
    // 第二行
    { title: '老客户数', value: stats.oldCustomerCount, color: C.info, icon: <TeamOutlined /> },
    { title: '老客户订单金额', value: stats.oldCustomerAmount, color: C.primary, icon: <DollarOutlined /> },
    { title: '新客户数', value: stats.newCustomerCount, color: C.purple, icon: <FireOutlined /> },
    { title: '新客户成交金额', value: stats.newCustomerAmount, color: C.purple, icon: <DollarOutlined /> },
    // 第三行
    { title: '线索→商机转化率', value: stats.leadToOpportunity, color: C.warning, icon: <PercentageOutlined />, suffix: '%' },
    { title: '商机→订单流转率', value: stats.opportunityToNext, color: C.warning, icon: <RiseOutlined />, suffix: '%' },
    { title: '下打样单→出货转化率', value: stats.sampleToOrder, color: C.success, icon: <ShoppingCartOutlined />, suffix: '%' },
    { title: '综合转化率（线索→订单）', value: stats.leadToOrder, color: C.primary, icon: <RiseOutlined />, suffix: '%' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>业务报告</Title>

      {[0, 4, 8].map((start, rowIdx) => (
        <Row key={rowIdx} gutter={cardGutter} style={{ marginBottom: 16 }} align="stretch">
          {statCards.slice(start, start + 4).map((item) => (
            <Col span={6} key={`${rowIdx}-${item.title}`}>
              <Card size="small" style={cardStyle(item.color)}>
                <Statistic
                  title={
                    <span style={{ color: token.colorTextSecondary, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: item.color }}>{item.icon}</span>
                      {item.title}
                    </span>
                  }
                  value={item.value}
                  styles={{
                    content: {
                      fontSize: 26,
                      fontWeight: 700,
                      color: token.colorText,
                      letterSpacing: '-0.3px',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }
                  }}
                  suffix={item.suffix ? <span style={{ fontSize: 16, color: token.colorTextTertiary }}>{item.suffix}</span> : undefined}
                />
              </Card>
            </Col>
          ))}
        </Row>
      ))}

      <Row gutter={cardGutter}>
        <Col span={12}>
          <Card size="small" title={<Space><ShoppingCartOutlined style={{ color: token.colorPrimary }} />近期订单</Space>}>
            <Table
              dataSource={recentOrders}
              rowKey="id"
              size="small"
              pagination={false}
              scroll={{ y: 340 }}
              columns={[
                { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: 120, render: (v: string) => v || '-' },
                { title: '客户', key: 'customer', width: 140, render: (_: any, r: any) => r.customer?.companyName || '-' },
                { title: '金额', dataIndex: 'amountCNY', key: 'amountCNY', width: 110, align: 'right' as const,
                  render: (v: number) => v != null ? <Price value={v} /> : '-' },
                { title: '日期', dataIndex: 'orderDate', key: 'orderDate', width: 100, render: (v: string) => v || '-' },
                { title: '状态', dataIndex: 'status', key: 'status', width: 90, render: (v: string) => <Tag color={v === '已发货' ? 'success' : v === '处理中' ? 'processing' : 'default'} variant="filled">{v || '-'}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card size="small" title={<Space><RiseOutlined style={{ color: token.colorSuccess }} />Top 下单客户</Space>}>
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
                  render: (v: number) => <Text strong><Price value={v} /></Text> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
