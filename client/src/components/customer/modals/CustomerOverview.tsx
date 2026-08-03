import React, { useMemo, useState } from 'react';
import { theme, Typography, Tooltip } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  CalendarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
import { Customer } from '../../../api/customers';
import Price from '../../common/Price';
import SegmentedTabBar from '../../common/SegmentedTabBar';
import { getCustomerTier } from '../shared/customerTier';

const { Text } = Typography;

// ============================================================
// 数据计算
// ============================================================

interface OverviewData {
  totalAmount: number;
  orderCount: number;
  yearAmount: number;
  yearOrderCount: number;
  lastYearAmount: number;
  avgAmount: number | null;
  lastOrderDate: string | null;
  firstOrderDate: string | null;
  categoryBreakdown: { name: string; amount: number; percent: number }[];
}

/** 按指定月数生成连续月份网格（从最早 -> 当前） */
function buildMonthGrid(months: number): Map<string, { amount: number; count: number }> {
  const now = dayjs();
  const grid = new Map<string, { amount: number; count: number }>();
  for (let i = months - 1; i >= 0; i--) {
    const m = now.subtract(i, 'month');
    grid.set(m.format('YYYY-MM'), { amount: 0, count: 0 });
  }
  return grid;
}

function computeOverview(customer: Customer): OverviewData {
  const orders = customer.orders || [];
  const now = dayjs();
  const currentYear = now.year();

  // 累计订单金额 & 笔数
  let totalAmount = 0;
  orders.forEach((o) => { totalAmount += o.amountCNY || 0; });

  // 本年消费
  let yearAmount = 0;
  let yearOrderCount = 0;
  // 去年同期
  let lastYearAmount = 0;

  // 品类分布（从 notes 提取品类关键词）
  const categoryMap = new Map<string, number>();

  orders.forEach((o) => {
    const amt = o.amountCNY || 0;
    const date = o.orderDate || o.createdAt;

    if (date) {
      const d = dayjs(date);
      const key = d.format('YYYY-MM');

      // 本年
      if (d.year() === currentYear) {
        yearAmount += amt;
        yearOrderCount++;
      }
      // 去年
      if (d.year() === currentYear - 1) {
        lastYearAmount += amt;
      }
    }

    // 品类提取：从 notes 中识别品类关键词
    if (o.notes) {
      const cats = extractCategories(o.notes);
      cats.forEach((c) => {
        categoryMap.set(c, (categoryMap.get(c) || 0) + amt);
      });
    }
  });

  // 平均客单价
  const avgAmount = orders.length > 0 ? totalAmount / orders.length : null;

  // 最近购买日期
  const lastOrderDate = customer.lastOrderDate || (orders.length > 0 ? (orders[0].orderDate || orders[0].createdAt) : null);

  // 首单日期
  const firstOrderDate: string | null = customer.firstOrderDate ||
    (orders.length > 0 ? orders[orders.length - 1]?.orderDate ?? null : null);

  // 品类分布排序
  const catTotal = Array.from(categoryMap.values()).reduce((s, a) => s + a, 0);
  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([name, amount]) => ({ name, amount, percent: catTotal > 0 ? Math.round(amount / catTotal * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  return {
    totalAmount,
    orderCount: orders.length,
    yearAmount,
    yearOrderCount,
    lastYearAmount,
    avgAmount,
    lastOrderDate,
    firstOrderDate,
    categoryBreakdown,
  };
}

/** 根据指定月数计算月度趋势（独立函数，便于按筛选重算） */
function computeMonthlyTrend(customer: Customer, months: number): { month: string; amount: number; count: number }[] {
  const orders = customer.orders || [];
  const grid = buildMonthGrid(months);
  orders.forEach((o) => {
    const date = o.orderDate || o.createdAt;
    if (!date) return;
    const key = dayjs(date).format('YYYY-MM');
    if (grid.has(key)) {
      const entry = grid.get(key)!;
      entry.amount += o.amountCNY || 0;
      entry.count++;
    }
  });
  return Array.from(grid.entries()).map(([month, v]) => ({
    month: months >= 12 ? month.slice(2) : month.slice(5),
    ...v,
  }));
}

/** 从订单备注中提取品类关键词 */
function extractCategories(notes: string): string[] {
  const keywords = [
    ['服务器', '服务器及计算'],
    ['存储', '存储设备'],
    ['网络', '网络设备'],
    ['电源', '电源及配件'],
    ['交换机', '网络设备'],
    ['路由器', '网络设备'],
    ['防火墙', '网络安全'],
    ['显示器', '外设'],
    ['软件', '软件服务'],
  ];
  const found: string[] = [];
  for (const [kw, label] of keywords) {
    if (notes.includes(kw) && !found.includes(label)) {
      found.push(label);
    }
  }
  return found.length > 0 ? found : ['其他'];
}

// ============================================================
// KPI 统计卡片
// ============================================================

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, color }) => {
  const { token } = theme.useToken();
  return (
    <div style={{
      background: token.colorBgContainer,
      borderRadius: 12,
      padding: '18px 20px',
      border: `1px solid ${token.colorBorderSecondary}`,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && (
          <span style={{
            fontSize: 16,
            color: color || token.colorPrimary,
            display: 'flex',
            alignItems: 'center',
          }}>{icon}</span>
        )}
        <Text type="secondary" style={{ fontSize: 13, fontWeight: 500 }}>{title}</Text>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: 12, color: token.colorTextTertiary, lineHeight: 1.4 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 月度趋势柱状图（纯 CSS，无图表库依赖）
// ============================================================

const MonthlyChart: React.FC<{ data: { month: string; amount: number; count: number }[]; primaryColor?: string; primaryBgColor?: string }> = ({ data, primaryColor, primaryBgColor }) => {
  const { token } = theme.useToken();
  const maxAmt = Math.max(...data.map(d => d.amount), 1);

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120, padding: '4px 0' }}>
      {data.map((d) => {
        const h = maxAmt > 0 ? (d.amount / maxAmt) * 100 : 0;
        return (
          <div key={d.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            {/* 柱子 */}
            <Tooltip title={`${d.month}月 ¥${d.amount.toLocaleString()} (${d.count}笔)`}>
              <div style={{
                width: '100%',
                maxWidth: 40,
                height: `${Math.max(h, d.count > 0 ? 4 : 2)}%`,
                minHeight: d.count > 0 ? 12 : 2,
                background: d.count > 0
                  ? `linear-gradient(180deg, ${primaryColor || token.colorPrimary} 0%, ${primaryBgColor || token.colorPrimaryBg} 100%)`
                  : token.colorFillQuaternary,
                borderRadius: 4,
                transition: 'height 0.3s ease',
              }} />
            </Tooltip>
            {/* 月份标签 */}
            <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{d.month}</Text>
          </div>
        );
      })}
    </div>
  );
};

// ============================================================
// 品类分布条形图
// ============================================================

const CategoryChart: React.FC<{ data: { name: string; amount: number; percent: number }[]; primaryColor?: string; primaryBgColor?: string }> = ({ data, primaryColor, primaryBgColor }) => {
  const { token } = theme.useToken();
  const maxPct = Math.max(...data.map(d => d.percent), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {data.map((d) => (
        <div key={d.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontSize: 13, fontWeight: 500 }}>{d.name}</Text>
            <Text type="secondary" style={{ fontSize: 13, fontWeight: 600 }}>{d.percent}%</Text>
          </div>
          <div style={{
            height: 8,
            background: token.colorFillQuaternary,
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${(d.percent / maxPct) * 100}%`,
              height: '100%',
              background: `linear-gradient(90deg, ${primaryColor || token.colorPrimary}, ${primaryBgColor || token.colorPrimaryHover})`,
              borderRadius: 4,
              minWidth: d.percent > 0 ? 24 : 0,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      ))}
      {data.length === 0 && (
        <Text type="secondary" style={{ fontSize: 13 }}>暂无品类数据</Text>
      )}
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

interface CustomerOverviewProps {
  customer: Customer;
}

/**
 * 客户成交数据概览 —— 展示在详情弹窗「概览」tab 内。
 *
 * 包含：
 * - 4 个 KPI 统计卡片（累计订单 / 本年消费 / 平均客单价 / 最近购买）
 * - 近 6 个月采购趋势柱状图
 * - 品类分布条形图
 * - 客户备注
 */
const CustomerOverview: React.FC<CustomerOverviewProps> = ({ customer }) => {
  const { token } = theme.useToken();
  const ct = useMemo(() => getCustomerTier(customer), [customer]);
  const data = useMemo(() => computeOverview(customer), [customer]);
  const [trendMonths, setTrendMonths] = useState(6);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(customer, trendMonths), [customer, trendMonths]);

  // 同比增长率
  const yoyPercent = data.lastYearAmount > 0
    ? ((data.yearAmount - data.lastYearAmount) / data.lastYearAmount * 100)
    : data.yearAmount > 0 ? 100 : 0;

  const rangeOptions = [
    { key: '3', label: '近3月' },
    { key: '6', label: '近6月' },
    { key: '12', label: '近12月' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* ===== KPI 统计卡片 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <StatCard
          title="累计订单"
          value={<Price value={data.totalAmount} />}
          subtitle={`共 ${data.orderCount} 笔`}
          icon={<FileTextOutlined />}
          color={token.colorPrimary}
        />
        <StatCard
          title="本年消费"
          value={<Price value={data.yearAmount} />}
          subtitle={
            data.lastYearAmount > 0
              ? <span style={{ color: yoyPercent >= 0 ? '#52c41a' : '#ff4d4f' }}>
                  {yoyPercent >= 0 ? '+' : ''}{yoyPercent.toFixed(1)}% vs 去年
                </span>
              : undefined
          }
          icon={<DollarOutlined />}
          color="#faad14"
        />
        <StatCard
          title="平均客单价"
          value={data.avgAmount != null ? <Price value={data.avgAmount} /> : '\u2014'}
          subtitle="当前记录均值"
          icon={<RiseOutlined />}
          color="#722ed1"
        />
        <StatCard
          title="最近购买"
          value={
            data.lastOrderDate
              ? dayjs(data.lastOrderDate).format('YYYY/MM/DD')
              : '\u2014'
          }
          subtitle={
            data.firstOrderDate
              ? `合作 ${dayjs(data.firstOrderDate).fromNow(true)}`
              : undefined
          }
          icon={<CalendarOutlined />}
          color="#13c2c2"
        />
      </div>

      {/* ===== 趋势 + 品类 上下结构 ===== */}
      {/* 采购趋势 */}
      <div style={{
        background: token.colorBgContainer,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: '18px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Text strong style={{ fontSize: 14 }}>采购趋势</Text>
          <SegmentedTabBar
            value={String(trendMonths)}
            onChange={(v) => setTrendMonths(Number(v))}
            options={rangeOptions}
            showCount={false}
            activeColor={ct.primary}
            style={{ transform: 'scale(0.92)', transformOrigin: 'right center' }}
          />
        </div>
        <MonthlyChart data={monthlyTrend} primaryColor={ct.primary} primaryBgColor={ct.primaryBg} />
      </div>

      {/* 品类分布 */}
      <div style={{
        background: token.colorBgContainer,
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: '18px 20px',
      }}>
        <Text strong style={{ fontSize: 14, marginBottom: 14, display: 'block' }}>
          品类分布
        </Text>
        <CategoryChart data={data.categoryBreakdown} primaryColor={ct.primary} primaryBgColor={ct.primaryBg} />
      </div>
    </div>
  );
};

export default CustomerOverview;
