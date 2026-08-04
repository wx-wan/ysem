import { Card, Row, Col, Popover, Progress } from 'antd';
import { PieChart, Pie, Cell, Tooltip as ReTooltip } from 'recharts';
import type { Customer, EstimatedBreakdownItem, ContractBreakdownItem } from '../../../api/customers';
import { INTENT_ORDER } from '../shared/intentLevel';
import Price from '../../common/Price';
import {
  GlobalOutlined,
  DollarOutlined,
  BankOutlined,
} from '@ant-design/icons';

const typeLabel: Record<string, string> = {
  all: '客户总数',
  noOrder: '未成交客户总数',
  'noOrder-A': 'A 级未成交客户',
  'noOrder-B': 'B 级未成交客户',
  'noOrder-C': 'C 级未成交客户',
  'noOrder-D': 'D 级未成交客户',
  done: '已成交客户总数',
  'done-new': '本年度新客总数',
  'done-old': '往年老客总数',
  key: '重点客户总数',
};

interface CustomerStatsProps {
  total: number;
  estimatedAmount?: number;
  totalContractAmount?: number;
  list: Customer[];
  token: any;
  filterType: string;
  estimatedBreakdown?: EstimatedBreakdownItem[];
  contractBreakdown?: ContractBreakdownItem[];
}

const chartColorKeys = [
  'colorPrimary', 'colorSuccess', 'colorWarning',
  'colorError', 'colorInfo', 'purple',
];

export default function CustomerStats({
  total,
  estimatedAmount = 0,
  totalContractAmount = 0,
  list,
  token,
  filterType,
  estimatedBreakdown,
  contractBreakdown = [],
}: CustomerStatsProps) {
  const countryStats = (() => {
    const map: Record<string, number> = {};
    list.forEach((c) => {
      if (!c.country) return;
      map[c.country] = (map[c.country] || 0) + 1;
    });
    const t = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([name, count]) => ({
        name,
        count,
        pct: t ? Math.round((count / t) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  })();

  const chartColors = chartColorKeys.map(
    (k) => (token as any)[k] || token.colorPrimary
  );

  // 三种渐变配色（基于 antd token 主题色）
  const gradients = [
    {
      from: token.colorPrimary,
      to: token.colorInfo,
      accent: 'rgba(255,255,255,0.18)',
      icon: <GlobalOutlined style={{ fontSize: 48, opacity: 0.25, color: '#fff' }} />,
    },
    {
      from: token.colorError,
      to: token.colorWarning,
      accent: 'rgba(255,255,255,0.18)',
      icon: <DollarOutlined style={{ fontSize: 48, opacity: 0.25, color: '#fff' }} />,
    },
    {
      from: token.colorSuccess,
      to: token.colorInfo,
      accent: 'rgba(255,255,255,0.18)',
      icon: <BankOutlined style={{ fontSize: 48, opacity: 0.25, color: '#fff' }} />,
    },
  ];

  const cards = [
    {
      value: total,
      label: typeLabel[filterType] || '客户总数',
      sub: (
        <Popover
          content={
            <div style={{ width: 240, textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: token.colorTextHeading }}>
                国家/地区分布
              </div>
              <div
                className="popover-chart-flex"
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <PieChart
                  width={180}
                  height={180}
                  margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                >
                  <Pie
                    data={countryStats}
                    dataKey="count"
                    nameKey="name"
                    cx={90}
                    cy={90}
                    innerRadius={50}
                    outerRadius={78}
                    stroke="none"
                  >
                    {countryStats.map((c, i) => (
                      <Cell
                        key={c.name}
                        fill={chartColors[i % chartColors.length]}
                      />
                    ))}
                  </Pie>
                  <foreignObject x="50%" y="50%" width="1" height="1">
                    <div
                      style={{
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center',
                        lineHeight: 1.2,
                        pointerEvents: 'none',
                      }}
                    >
                      <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
                        {countryStats.length}
                      </div>
                      <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>
                        个国家/地区
                      </div>
                    </div>
                  </foreignObject>
                </PieChart>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px 10px',
                  marginTop: 8,
                  justifyContent: 'center',
                }}
              >
                {countryStats.map((c, i) => (
                  <div
                    key={c.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: token.colorTextSecondary,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        backgroundColor: chartColors[i % chartColors.length],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ whiteSpace: 'nowrap' }}>
                      {c.name} {c.pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          }
          title={null}
        >
          <span style={{ cursor: 'pointer' }}>
            {countryStats.length} 个国家/地区
          </span>
        </Popover>
      ),
      ...gradients[0],
    },
    {
      value: <Price value={estimatedAmount} />,
      label: '预计商机金额',
      sub: (
        <Popover
          title={null}
          content={
            estimatedBreakdown && estimatedBreakdown.length > 0 ? (
              <div style={{ width: 300, padding: 4 }}>
                {(() => {
                  const total = estimatedBreakdown.reduce(
                    (sum, item) => sum + (item._sum.estimatedAmount || 0),
                    0
                  );
                  const data = Object.values(
                    estimatedBreakdown.reduce((acc, item) => {
                      const name = item.probability || '低意向';
                      const amount = item._sum.estimatedAmount || 0;
                      if (!acc[name]) acc[name] = { name, count: 0, amount: 0, percent: 0 };
                      acc[name].count += item._count;
                      acc[name].amount += amount;
                      return acc;
                    }, {} as Record<string, { name: string; count: number; amount: number; percent: number }>)
                  )
                    .map((item) => ({
                      ...item,
                      percent: total > 0 ? (item.amount / total) * 100 : 0,
                    }))
                    .sort((a, b) => INTENT_ORDER.indexOf(a.name) - INTENT_ORDER.indexOf(b.name));
                  const colors = ['#7c3aed', '#6366f1', '#06b6d4', '#10b981'];
                  return (
                    <>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          marginBottom: 12,
                          color: token.colorTextHeading,
                        }}
                      >
                        意向分布
                      </div>
                      {data.map((item, idx) => (
                        <div key={item.name} style={{ marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 13, color: token.colorText }}>{item.name}</span>
                            <span style={{ fontSize: 13, fontWeight: 600, color: token.colorTextHeading }}>
                              <Price value={item.amount} />
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <Progress
                                percent={item.percent}
                                showInfo={false}
                                strokeColor={colors[idx % colors.length]}
                                railColor="#f1f5f9"
                              />
                            </div>
                            <span style={{ fontSize: 12, color: token.colorTextSecondary, minWidth: 36, textAlign: 'right' }}>
                              {item.percent.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: token.colorTextSecondary }}>
                暂无预估数据
              </div>
            )
          }
        >
          <span style={{ cursor: 'pointer' }}>查看详情</span>
        </Popover>
      ),
      ...gradients[1],
    },
    {
      value: <Price value={totalContractAmount} />,
      label: '累计成交订单金额',
      sub: (
        <Popover
          title={null}
          content={
            <div style={{ width: 260, padding: 4 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: token.colorTextHeading }}>
                新老客户占比
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <PieChart width={180} height={180}>
                  <Pie
                    data={contractBreakdown}
                    dataKey="amount"
                    nameKey="type"
                    cx={90}
                    cy={90}
                    innerRadius={50}
                    outerRadius={78}
                    stroke="none"
                  >
                    <Cell fill="#7c3aed" />
                    <Cell fill="#f59e0b" />
                  </Pie>
                  <ReTooltip formatter={(value) => <Price value={Number(value)} />} />
                  <foreignObject x="50%" y="50%" width="1" height="1">
                    <div
                      style={{
                        transform: 'translate(-50%, -50%)',
                        textAlign: 'center',
                        lineHeight: 1.2,
                        pointerEvents: 'none',
                      }}
                    >
                      <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
                        {totalContractAmount > 0 ? ((totalContractAmount / 10000).toFixed(1)) : 0}
                      </div>
                      <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>
                        万
                      </div>
                    </div>
                  </foreignObject>
                </PieChart>
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 4 }}>
                {contractBreakdown.map((item, idx) => {
                  const percent = totalContractAmount > 0
                    ? ((item.amount / totalContractAmount) * 100).toFixed(1)
                    : '0';
                  const colors = ['#7c3aed', '#f59e0b'];
                  return (
                    <div
                      key={item.type}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 13,
                        color: token.colorTextSecondary,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          backgroundColor: colors[idx],
                          flexShrink: 0,
                        }}
                      />
                      <span>
                        {item.type} {percent}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          }
        >
          <span style={{ cursor: 'pointer' }}>
            查看占比
          </span>
        </Popover>
      ),
      ...gradients[2],
    },
  ];

  return (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      {cards.map((c, i) => (
        <Col xs={24} sm={8} key={i}>
          <Card
            style={{
              borderRadius: 16,
              border: 'none',
              overflow: 'hidden',
              position: 'relative',
              background: `linear-gradient(135deg, ${c.from} 0%, ${c.to} 100%)`,
            }}
            styles={{ body: { padding: '24px 28px', position: 'relative' } }}
          >
            {/* 装饰圆 1 */}
            <div
              style={{
                position: 'absolute',
                top: -40,
                right: -40,
                width: 140,
                height: 140,
                borderRadius: '50%',
                background: c.accent,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />
            {/* 装饰圆 2 */}
            <div
              style={{
                position: 'absolute',
                bottom: -30,
                right: 60,
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: c.accent,
                pointerEvents: 'none',
                zIndex: 0,
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'relative',
                zIndex: 1,
              }}
            >
              {/* 左侧文字 */}
              <div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.75)',
                    fontWeight: 500,
                    lineHeight: 1,
                  }}
                >
                  {c.label}
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    color: '#fff',
                    lineHeight: 1.2,
                    marginTop: 8,
                  }}
                >
                  {c.value}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.65)',
                    marginTop: 6,
                  }}
                >
                  {c.sub}
                </div>
              </div>

              {/* 右侧图标 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {c.icon}
              </div>
            </div>
          </Card>
        </Col>
      ))}
    </Row>
  );
}
