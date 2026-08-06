import React, { useMemo, useState } from 'react';
import { theme, Typography, Tooltip } from 'antd';
import {
  DollarOutlined,
  RiseOutlined,
  CalendarOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

/** 将日期转为中文时长，如 "1 年 2 个月"、"6 个月"、"15 天" */
function formatDuration(since: Date | string): string {
  const now = dayjs();
  const d = dayjs(since);
  const totalMonths = now.diff(d, 'month');
  if (totalMonths >= 12) {
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    return months > 0 ? `${years} 年 ${months} 个月` : `${years} 年`;
  }
  if (totalMonths >= 1) return `${totalMonths} 个月`;
  const days = now.diff(d, 'day');
  return `${days} 天`;
}

import { Customer } from '../../../api/customers';
import Price from '../../common/Price';
import SegmentedTabBar from '../../common/SegmentedTabBar';
import { getCustomerTier } from '../shared/customerTier';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

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
  /** 转化率 */
  leadToOppRate: number | null;     // 线索→商机
  oppToOrderRate: number | null;    // 商机→订单
  leadToOrderRate: number | null;   // 线索→订单（综合）
  sampleOrderCount: number;         // 样品单数
  sampleOrderAmount: number;        // 样品单成交金额
}

// ============================================================
// 采购趋势数据（订单 + 商机管道）
// ============================================================

/** 商机意向等级 */
type PipelineLevel = '准成交' | '高' | '中' | '低' | '意向';

/** 月度趋势数据点（含实际订单 + 商机管道预估） */
interface MonthlyTrendItem {
  month: string;
  actualAmount: number;
  actualCount: number;
  pipelineAmount: number;
  pipelineCount: number;
  pipelineDetails: { level: PipelineLevel; amount: number; title?: string }[];
}

/** 商机管道记录的轻量类型 */
interface PipelineRecord {
  stage?: string;
  probability?: string | null;
  estimatedAmount?: number | null;
  estimatedCloseDate?: string | null;
  title?: string;
}

/** 将 probability 文本映射为展示等级 */
function mapPipelineLevel(probability?: string | null): PipelineLevel {
  if (!probability) return '意向';
  if (probability.includes('准成交')) return '准成交';
  if (probability.includes('高')) return '高';
  if (probability.includes('中')) return '中';
  if (probability.includes('低')) return '低';
  return '意向';
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

  // 管道转化率计算
  const pipelines = customer.pipelines || [];
  const totalPipelines = pipelines.length;
  const oppCount = pipelines.filter(p => ['OPPORTUNITY', 'ORDER'].includes(p.stage)).length;
  const orderPipelineCount = pipelines.filter(p => p.stage === 'ORDER').length;

  const leadToOppRate = totalPipelines > 0 ? Math.round(oppCount / totalPipelines * 100) : null;
  const oppToOrderRate = oppCount > 0 ? Math.round(orderPipelineCount / oppCount * 100) : null;
  const leadToOrderRate = totalPipelines > 0 ? Math.round(orderPipelineCount / totalPipelines * 100) : null;

  // 下打样单阶段订单数（样品单融入订单流程）
  const sampleOrderCount = orders.filter(o => o.status === 'SAMPLE_ORDER').length;

  // 下打样单阶段订单成交金额
  const sampleOrderAmount = orders
    .filter(o => o.status === 'SAMPLE_ORDER')
    .reduce((sum, o) => sum + (o.amountCNY || 0), 0);

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
    leadToOppRate,
    oppToOrderRate,
    leadToOrderRate,
    sampleOrderCount,
    sampleOrderAmount,
  };
}

/** 计算月度趋势（订单成交 + 商机管道按预计下单时间分摊） */
function computeMonthlyTrendWithPipeline(customer: Customer, months: number): MonthlyTrendItem[] {
  const now = dayjs();
  const grid = new Map<string, { actualAmount: number; actualCount: number; pipelineAmount: number; pipelineCount: number; pipelineDetails: MonthlyTrendItem['pipelineDetails'] }>();

  for (let i = months - 1; i >= 0; i--) {
    const m = now.subtract(i, 'month');
    grid.set(m.format('YYYY-MM'), { actualAmount: 0, actualCount: 0, pipelineAmount: 0, pipelineCount: 0, pipelineDetails: [] });
  }

  // 实际订单
  (customer.orders || []).forEach((o) => {
    const date = o.orderDate || o.createdAt;
    if (!date) return;
    const key = dayjs(date).format('YYYY-MM');
    const entry = grid.get(key);
    if (entry) { entry.actualAmount += o.amountCNY || 0; entry.actualCount++; }
  });

  // 商机管道（按 estimatedCloseDate 确定月份落点）
  const pipelines = (customer.pipelines || []) as PipelineRecord[];
  pipelines.forEach((p) => {
    const date = p.estimatedCloseDate;
    if (!date) return;
    const key = dayjs(date).format('YYYY-MM');
    const entry = grid.get(key);
    const amt = p.estimatedAmount || 0;
    if (entry && amt > 0) {
      entry.pipelineAmount += amt;
      entry.pipelineCount++;
      entry.pipelineDetails.push({
        level: mapPipelineLevel(p.probability),
        amount: amt,
        title: p.title,
      });
    }
  });

  const MONTHS_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Array.from(grid.entries()).map(([month, v]) => {
    const m = dayjs(month + '-01');
    const label = months >= 12
      ? `${m.format('YY')} ${MONTHS_ABBR[m.month()]}`
      : MONTHS_ABBR[m.month()];
    return { month: label, ...v };
  });
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
  extra?: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, extra, icon, color }) => {
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
      {extra && (
        <div style={{ fontSize: 11, color: token.colorPrimary, lineHeight: 1.3, fontWeight: 500, opacity: 0.85 }}>
          {extra}
        </div>
      )}
    </div>
  );
};

// ============================================================
// 月度趋势柱状图（实心=实际成交 / 虚线=商机管道预估）
// ============================================================

const MonthlyChart: React.FC<{ data: MonthlyTrendItem[]; primaryColor?: string; primaryBgColor?: string }> = ({ data, primaryColor, primaryBgColor }) => {
  const { token } = theme.useToken();
  const maxVal = Math.max(...data.map(d => d.actualAmount + d.pipelineAmount), 1);
  const barWidth = 40;
  const gap = 10;
  const isCompact = data.length > 6;

  const scrollStyles: React.CSSProperties = isCompact
    ? { minWidth: data.length * barWidth + (data.length - 1) * gap }
    : {};

  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
      <style>{`
        .monthly-chart-scroll::-webkit-scrollbar { height: 5px; }
        .monthly-chart-scroll::-webkit-scrollbar-track { background: ${token.colorFillQuaternary}; border-radius: 3px; }
        .monthly-chart-scroll::-webkit-scrollbar-thumb { background: ${primaryColor || token.colorPrimary}40; border-radius: 3px; }
        .monthly-chart-scroll::-webkit-scrollbar-thumb:hover { background: ${primaryColor || token.colorPrimary}70; }
      `}</style>
      <div
        className="monthly-chart-scroll"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap,
          height: 140,
          padding: '4px 0 8px',
          ...scrollStyles,
        }}
      >
        {data.map((d) => {
          const actualH = maxVal > 0 ? (d.actualAmount / maxVal) * 100 : 0;
          const pipelineH = maxVal > 0 ? (d.pipelineAmount / maxVal) * 100 : 0;

          const pipelineLevels = d.pipelineDetails
            .filter(p => p.amount > 0)
            .sort((a, b) => b.amount - a.amount)
            .map(p => `${p.level} ¥${p.amount.toLocaleString()}`)
            .join(' · ');

          const tipTitle = (
            <div>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.month}</div>
              {d.actualCount > 0 && <div>成交 ¥{d.actualAmount.toLocaleString()}（{d.actualCount}笔）</div>}
              {d.actualCount === 0 && <div>暂无成交</div>}
              {d.pipelineCount > 0 && <div>商机 ¥{d.pipelineAmount.toLocaleString()}（{d.pipelineCount}个）</div>}
              {pipelineLevels && <div style={{ color: token.colorTextTertiary, fontSize: 11, marginTop: 2, maxWidth: 200, whiteSpace: 'normal' }}>{pipelineLevels}</div>}
            </div>
          );

          const colStyle: React.CSSProperties = isCompact
            ? { flex: `0 0 ${barWidth}px`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%' }
            : { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', minWidth: 0 };

          return (
            <Tooltip key={d.month} title={tipTitle}>
              <div style={colStyle}>
                <div style={{ flex: 1, position: 'relative', width: '100%' }}>
                  {/* 成交柱（实心填充，底层） */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: '15%',
                    width: '70%',
                    height: `${actualH}%`,
                    minHeight: d.actualCount > 0 ? 4 : 0,
                    background: d.actualCount > 0
                      ? `linear-gradient(180deg, ${primaryColor || token.colorPrimary} 0%, ${primaryBgColor || token.colorPrimaryBg} 100%)`
                      : 'transparent',
                    borderRadius: 4,
                    transition: 'height 0.3s ease',
                    pointerEvents: 'none',
                  }} />
                  {/* 商机柱（虚线边框，叠加在成交柱上方） */}
                  {pipelineH > 0 && (
                    <div style={{
                      position: 'absolute',
                      bottom: `${actualH}%`,
                      left: '15%',
                      width: '70%',
                      height: `${pipelineH}%`,
                      border: `2px dashed ${primaryColor || token.colorPrimary}50`,
                      borderRadius: 4,
                      boxSizing: 'border-box',
                      transition: 'height 0.3s ease',
                      pointerEvents: 'none',
                    }} />
                  )}
                </div>
                <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{d.month}</Text>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================
// 品类分布环形图
// ============================================================

/** 将主题色淡化生成同色系调色板 */
function tintColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const blend = (c: number) => Math.round(c + (255 - c) * factor);
  return `#${blend(r).toString(16).padStart(2, '0')}${blend(g).toString(16).padStart(2, '0')}${blend(b).toString(16).padStart(2, '0')}`;
}

function generatePalette(primary: string, count: number): string[] {
  const tints = [0, 0.18, 0.38, 0.56, 0.72, 0.84, 0.92, 0.96];
  return tints.slice(0, Math.max(count, 1)).map(t => tintColor(primary, t));
}

const CategoryChart: React.FC<{ data: { name: string; amount: number; percent: number }[]; primaryColor?: string }> = ({ data, primaryColor = '#1677ff' }) => {
  const palette = generatePalette(primaryColor, data.length);

  if (data.length === 0) {
    return <Text type="secondary" style={{ fontSize: 13 }}>暂无品类数据</Text>;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <ResponsiveContainer width={170} height={170}>
        <PieChart>
          <RechartsTooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = (payload[0] as { payload: { name: string; amount: number; percent: number } }).payload;
                return (
                  <div style={{
                    background: '#fff',
                    borderRadius: 8,
                    padding: '8px 12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    border: '1px solid rgba(0,0,0,0.06)',
                    fontSize: 12,
                  }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
                    <div style={{ color: '#666' }}>成交金额: <span style={{ color: primaryColor, fontWeight: 600 }}><Price value={d.amount} /></span></div>
                    <div style={{ color: '#999' }}>占比: {d.percent}%</div>
                  </div>
                );
              }
              return null;
            }}
          />
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={42}
            outerRadius={72}
            dataKey="percent"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((_, idx) => (
              <Cell key={idx} fill={palette[idx]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        {data.map((d, idx) => (
          <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: palette[idx],
                flexShrink: 0,
              }} />
              <Text style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</Text>
            </div>
            <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{d.percent}%</Text>
          </div>
        ))}
      </div>
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
 * - 4 个转化率统计卡片（线索/商机/综合转化率 / 样品单数）
 * - 采购趋势柱状图（实心=已成交订单，虚线=商机管道预估）
 * - 品类分布环形图
 */
const CustomerOverview: React.FC<CustomerOverviewProps> = ({ customer }) => {
  const { token } = theme.useToken();
  const ct = useMemo(() => getCustomerTier(customer), [customer]);
  const data = useMemo(() => computeOverview(customer), [customer]);
  const [trendMonths, setTrendMonths] = useState(6);
  const monthlyTrend = useMemo(() => computeMonthlyTrendWithPipeline(customer, trendMonths), [customer, trendMonths]);

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
              ? `合作 ${formatDuration(data.firstOrderDate)}`
              : undefined
          }
          icon={<CalendarOutlined />}
          color="#13c2c2"
        />
      </div>

      {/* ===== 转化率统计 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <StatCard
          title="线索转化率"
          value={data.leadToOppRate != null ? `${data.leadToOppRate}%` : '\u2014'}
          subtitle="线索 → 商机"
          icon={<span style={{ fontSize: 12, fontWeight: 700 }}>→</span>}
          color={ct.primary}
        />
        <StatCard
          title="商机转化率"
          value={data.oppToOrderRate != null ? `${data.oppToOrderRate}%` : '\u2014'}
          subtitle="商机 → 订单"
          icon={<span style={{ fontSize: 12, fontWeight: 700 }}>→</span>}
          color={ct.primary}
        />
        <StatCard
          title="综合转化率"
          value={data.leadToOrderRate != null ? `${data.leadToOrderRate}%` : '\u2014'}
          subtitle="线索 → 订单"
          icon={<span style={{ fontSize: 12, fontWeight: 700 }}>→</span>}
          color={ct.primary}
        />
        <StatCard
          title="下打样单数"
          value={`${data.sampleOrderCount} 单`}
          icon={<FileTextOutlined />}
          color="#eb2f96"
          extra={
            data.sampleOrderAmount > 0
              ? <>成交金额 <Price value={data.sampleOrderAmount} /></>
              : undefined
          }
        />
      </div>

      {/* ===== 趋势 + 品类 左右结构 ===== */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'stretch' }}>
        {/* 采购趋势 */}
        <div style={{
          flex: 1.2,
          background: token.colorBgContainer,
          borderRadius: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          padding: '18px 20px',
          minWidth: 0,
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
          flex: 1,
          background: token.colorBgContainer,
          borderRadius: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          padding: '18px 20px',
          minWidth: 0,
        }}>
          <Text strong style={{ fontSize: 14, marginBottom: 14, display: 'block' }}>
            品类分布
          </Text>
          <CategoryChart data={data.categoryBreakdown} primaryColor={ct.primary} />
        </div>
      </div>
    </div>
  );
};

export default CustomerOverview;
