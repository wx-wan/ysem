import React, { useMemo } from 'react';
import { Empty, theme, Typography } from 'antd';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  ShoppingCartOutlined, DollarOutlined, WalletOutlined, LineChartOutlined,
  CalendarOutlined, ExperimentOutlined, SwapOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { SalesItem } from '../../../api/sales';
import { SALES_STAGES, getStageMeta, getStageI18nKey } from '../../sales/stages';
import { Product } from '../../../api/products';
import Price from '../../common/Price';

const { Text } = Typography;

interface ProductOverviewProps {
  product: Product;
  salesList: SalesItem[];
  loading?: boolean;
}

// 最近 6 个月标签
const MONTH_FMT = 'YYYY-MM';

const ProductOverview: React.FC<ProductOverviewProps> = ({ product, salesList, loading }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  // 派生指标
  const stats = useMemo(() => {
    const orders = salesList.filter((s) => s.stage === 'ORDER');
    const samples = salesList.filter((s) => s.orderType === 'SAMPLE');
    const totalAmount = orders.reduce((sum, s) => sum + (s.orderAmount || 0), 0);
    const thisYear = dayjs().year();
    const thisYearAmount = orders
      .filter((s) => s.orderDate && dayjs(s.orderDate).year() === thisYear)
      .reduce((sum, s) => sum + (s.orderAmount || 0), 0);
    const avgAmount = orders.length ? totalAmount / orders.length : 0;
    const lastOrderDate = orders
      .map((s) => s.orderDate)
      .filter(Boolean)
      .sort()
      .pop();
    const conversionRate = samples.length ? (orders.length / samples.length) * 100 : null;

    return {
      totalAmount,
      thisYearAmount,
      avgAmount,
      lastOrderDate: lastOrderDate || null,
      sampleCount: samples.length,
      conversionRate,
    };
  }, [salesList]);

  // 月度趋势：订单金额（实际）+ 商机/线索预估金额
  const trendData = useMemo(() => {
    const now = dayjs();
    const months = Array.from({ length: 6 }, (_, i) => now.subtract(5 - i, 'month'));
    return months.map((m) => {
      const key = m.format(MONTH_FMT);
      const orderAmount = salesList
        .filter((s) => s.stage === 'ORDER' && s.orderDate && s.orderDate.startsWith(key))
        .reduce((sum, s) => sum + (s.orderAmount || 0), 0);
      const pipelineAmount = salesList
        .filter(
          (s) =>
            (s.stage === 'OPPORTUNITY' || s.stage === 'LEAD') &&
            s.estimatedCloseDate &&
            s.estimatedCloseDate.startsWith(key),
        )
        .reduce((sum, s) => sum + (s.estimatedAmount || 0), 0);
      return { month: m.format('MMM'), 销售金额: orderAmount, 预估金额: pipelineAmount };
    });
  }, [salesList]);

  // 阶段分布（阶段为后端派生的只读值）
  const distData = useMemo(() => {
    return SALES_STAGES.map((stage) => ({
      name: t(`sales.stage.${getStageI18nKey(stage)}`),
      value: salesList.filter((s) => s.stage === stage).length,
      color: getStageMeta(stage).color,
    }));
  }, [salesList, t]);

  const cardBase: React.CSSProperties = {
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 16,
    padding: 16,
    background: token.colorBgContainer,
  };

  const metrics = [
    {
      icon: <ShoppingCartOutlined />, label: '累积成交金额', value: <Price value={stats.totalAmount} />,
      sub: '单产品历史成交金额', color: '#1677ff',
    },
    {
      icon: <DollarOutlined />, label: '本年销量', value: <Price value={stats.thisYearAmount} />,
      sub: `${dayjs().year()} 年成交金额`, color: '#16a34a',
    },
    {
      icon: <WalletOutlined />, label: '平均客单价', value: <Price value={stats.avgAmount} />,
      sub: '单笔订单均值', color: '#d97706',
    },
    {
      icon: <CalendarOutlined />, label: '最近下单', value: stats.lastOrderDate ? dayjs(stats.lastOrderDate).format('YYYY-MM-DD') : '—',
      sub: '最近成交时间', color: '#7c3aed',
    },
    {
      icon: <ExperimentOutlined />, label: '下打样单数', value: String(stats.sampleCount),
      sub: '累计打样需求', color: '#0891b2',
    },
    {
      icon: <SwapOutlined />, label: '样品到订单率', value: stats.conversionRate != null ? `${stats.conversionRate.toFixed(1)}%` : '—',
      sub: '打样转正式订单', color: '#db2777',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* 指标卡 3×2 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {metrics.map((m) => (
          <div key={m.label} style={cardBase}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: `${m.color}14`, color: m.color, fontSize: 14,
                }}
              >
                {m.icon}
              </span>
              <span style={{ fontSize: 13, color: token.colorTextSecondary }}>{m.label}</span>
            </div>
            <div style={{ fontSize: 21, fontWeight: 800, color: token.colorTextHeading, lineHeight: 1.15 }}>
              {m.value}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 3 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* 趋势 + 分布 */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div style={{ ...cardBase, flex: 1.6, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 3, height: 13, borderRadius: 2, background: token.colorPrimary, display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: token.colorTextSecondary }}>销售趋势</span>
            <LineChartOutlined style={{ color: token.colorTextTertiary, fontSize: 13 }} />
          </div>
          {loading ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: token.colorTextTertiary }}>加载中…</div>
          ) : trendData.some((d) => d.销售金额 > 0 || d.预估金额 > 0) ? (
            <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={token.colorBorderSecondary} />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: token.colorTextTertiary }} axisLine={{ stroke: token.colorBorderSecondary }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: token.colorTextTertiary }} axisLine={false} tickLine={false} width={48} />
                  <RTooltip
                    formatter={(v: any) => <Price value={Number(v) || 0} />}
                    contentStyle={{ borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="销售金额" fill="#1677ff" radius={[6, 6, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="预估金额" fill="#d97706" radius={[6, 6, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
            </div>
          )}
        </div>

        <div style={{ ...cardBase, flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 3, height: 13, borderRadius: 2, background: token.colorPrimary, display: 'inline-block' }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: token.colorTextSecondary }}>阶段分布</span>
          </div>
          {distData.some((d) => d.value > 0) ? (
            <div style={{ flex: 1, minHeight: 0, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="52%"
                    outerRadius="80%"
                    paddingAngle={3}
                    label={(entry: any) => `${entry.name} ${entry.value}`}
                    labelLine={false}
                  >
                    {distData.map((d) => (
                      <Cell key={d.name} fill={d.color} />
                    ))}
                  </Pie>
                  <RTooltip contentStyle={{ borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null} />
            </div>
          )}
        </div>
      </div>

    </div>
  );
};

export default ProductOverview;
