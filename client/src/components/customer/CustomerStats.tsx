import { Card, Row, Col, Popover } from 'antd';
import { PieChart, Pie, Cell } from 'recharts';
import type { Customer } from '../../api/customers';
import { getGrade } from './utils';

interface CustomerStatsProps {
  total: number;
  list: Customer[];
  token: any;
  formatCurrency: (value: number) => string;
}

const chartColorKeys = [
  'colorPrimary', 'colorSuccess', 'colorWarning',
  'colorError', 'colorInfo', 'purple',
];

export default function CustomerStats({ total, list, token, formatCurrency }: CustomerStatsProps) {
  const totalCustomers = total;
  const aGradeCount = list.filter((c) => getGrade(c).grade === 'A').length;
  const totalContract = list.reduce((sum, c) => sum + (c.totalAmount || 0), 0);

  const countryStats = (() => {
    const map: Record<string, number> = {};
    list.forEach(c => {
      if (!c.country) return;
      map[c.country] = (map[c.country] || 0) + 1;
    });
    const t = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([name, count]) => ({ name, count, pct: t ? Math.round((count / t) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  })();

  const chartColors = chartColorKeys.map(k => (token as any)[k] || token.colorPrimary);

  return (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: token.boxShadow }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${token.colorPrimary} 0%, ${token.colorInfo} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              🌍
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: token.colorTextHeading, lineHeight: 1 }}>{totalCustomers}</div>
              <div style={{ fontSize: 13, color: token.colorTextSecondary, marginTop: 4 }}>客户总数</div>
              <Popover
                content={
                  <div style={{ width: 240, textAlign: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: token.colorTextHeading }}>国家/地区分布</div>
                    <div className="popover-chart-flex" style={{ display: 'flex', justifyContent: 'center' }}>
                      <PieChart width={180} height={180} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
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
                            <Cell key={c.name} fill={chartColors[i % chartColors.length]} />
                          ))}
                        </Pie>
                        <foreignObject x="50%" y="50%" width="1" height="1">
                          <div style={{ transform: 'translate(-50%, -50%)', textAlign: 'center', lineHeight: 1.2, pointerEvents: 'none' }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>{countryStats.length}</div>
                            <div style={{ fontSize: 11, color: token.colorTextSecondary, marginTop: 2 }}>个国家/地区</div>
                          </div>
                        </foreignObject>
                      </PieChart>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8, justifyContent: 'center' }}>
                      {countryStats.map((c, i) => (
                        <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: token.colorTextSecondary }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: chartColors[i % chartColors.length], flexShrink: 0 }} />
                          <span style={{ whiteSpace: 'nowrap' }}>{c.name} {c.pct}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                }
                title={null}
              >
                <div style={{ fontSize: 12, color: token.colorPrimary, marginTop: 2, cursor: 'pointer' }}>{countryStats.length} 个国家/地区</div>
              </Popover>
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: token.boxShadow }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${token.colorError} 0%, ${token.colorWarning} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              ⭐
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: token.colorTextHeading, lineHeight: 1 }}>{aGradeCount}</div>
              <div style={{ fontSize: 13, color: token.colorTextSecondary, marginTop: 4 }}>A级客户</div>
              <div style={{ fontSize: 12, color: token.colorTextDescription, marginTop: 2 }}>战略合作伙伴</div>
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: token.boxShadow }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `linear-gradient(135deg, ${token.colorSuccess} 0%, ${token.colorInfo} 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              🏦
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: token.colorTextHeading, lineHeight: 1 }}>{formatCurrency(totalContract || 0)}</div>
              <div style={{ fontSize: 13, color: token.colorTextSecondary, marginTop: 4 }}>累计合同额</div>
              <div style={{ fontSize: 12, color: token.colorTextDescription, marginTop: 2 }}>今年度</div>
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  );
}
