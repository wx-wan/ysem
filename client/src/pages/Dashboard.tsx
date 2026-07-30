import React from "react";
import { useTranslation } from "react-i18next";
import {
  Row,
  Col,
  Card,
  Button,
  Table,
  Typography,
  Space,
} from "antd";
import {
  DollarOutlined,
  ShoppingCartOutlined,
  UserOutlined,
  RiseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useAuthStore } from "../stores/useAuthStore";
import MonthCountdown from "../components/MonthCountdown";

const { Title, Text } = Typography;

/* ---- 假数据 ---- */
const revenueData = [
  { month: "8月", revenue: 32000 },
  { month: "9月", revenue: 38000 },
  { month: "10月", revenue: 35000 },
  { month: "11月", revenue: 42000 },
  { month: "12月", revenue: 40000 },
  { month: "1月", revenue: 45690 },
];

const recentOrders = [
  { key: "1", orderNo: "ORD-20260101", customer: "Li Wei", product: "儿童玩具套装", amount: "$1,280", status: "已发货" },
  { key: "2", orderNo: "ORD-20260102", customer: "Wang Fang", product: "益智拼图", amount: "$860", status: "处理中" },
  { key: "3", orderNo: "ORD-20260103", customer: "Zhang Min", product: "遥控赛车", amount: "$2,100", status: "已发货" },
  { key: "4", orderNo: "ORD-20260104", customer: "Chen Yu", product: "毛绒玩偶", amount: "$420", status: "已完成" },
  { key: "5", orderNo: "ORD-20260105", customer: "Liu Yang", product: "积木套装", amount: "$1,650", status: "处理中" },
];

const statusColor: Record<string, string> = {
  "已发货": "#10b981",
  "处理中": "#f59e0b",
  "已完成": "#3b82f6",
};

const pieData = [
  { name: "儿童玩具", value: 35, color: "#3b82f6" },
  { name: "益智拼图", value: 25, color: "#8b5cf6" },
  { name: "遥控赛车", value: 22, color: "#10b981" },
  { name: "毛绒玩偶", value: 18, color: "#f59e0b" },
];

const products = [
  { icon: "🧸", name: "儿童玩具套装", percent: 35, earnings: "$15,900", color: "#3b82f6" },
  { icon: "🧩", name: "益智拼图", percent: 25, earnings: "$11,400", color: "#8b5cf6" },
  { icon: "🏎️", name: "遥控赛车", percent: 22, earnings: "$10,100", color: "#10b981" },
  { icon: "🧸", name: "毛绒玩偶", percent: 18, earnings: "$8,290", color: "#f59e0b" },
];

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  /* ---- 列定义 ---- */
  const columns = [
    {
      title: t("common.noData"),
      dataIndex: "orderNo",
      key: "orderNo",
      width: 140,
      render: (v: string) => <span style={{ color: "#3b82f6", fontWeight: 500, fontSize: 13 }}>{v}</span>,
    },
    {
      title: "客户",
      dataIndex: "customer",
      key: "customer",
      render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
    },
    {
      title: "产品",
      dataIndex: "product",
      key: "product",
      render: (v: string) => <span style={{ fontSize: 13 }}>{v}</span>,
    },
    {
      title: "金额",
      dataIndex: "amount",
      key: "amount",
      render: (v: string) => <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>,
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      render: (v: string) => (
        <Space size={6}>
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: statusColor[v] || "#94a3b8",
            }}
          />
          <span style={{ fontSize: 12, color: statusColor[v] || "#94a3b8" }}>{v}</span>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* ===== 顶部三列卡片（欢迎 / 倒计时 / 导出） ===== */}
      <Row gutter={[16, 16]} className="dashboard-welcome-row">
        {/* 欢迎 */}
        <Col xs={24} md={8}>
          <Card className="welcome-card" variant="borderless">
            <Title level={4} className="card-heading">
              {t("dashboard.welcomeBack")}, {user?.realName || user?.username || t("common.noData")}
            </Title>
            <span className="card-subtitle">{t("dashboard.overviewText")}</span>
          </Card>
        </Col>

        {/* 倒计时 */}
        <Col xs={24} md={8}>
          <Card className="countdown-card" variant="borderless">
            <MonthCountdown />
          </Card>
        </Col>

        {/* 导出 */}
        <Col xs={24} md={8}>
          <Card className="export-card" variant="borderless">
            <Title level={4} className="card-heading" style={{ marginBottom: 8 }}>
              {t("dashboard.exportReport")}
            </Title>
            <span className="card-subtitle" style={{ marginBottom: 16 }}>
              一键导出本月业绩数据报告
            </span>
            <Button icon={<ExportOutlined />} size="large" className="export-btn" block>
              {t("dashboard.exportReport")}
            </Button>
          </Card>
        </Col>
      </Row>

      {/* ===== 统计卡片 ===== */}
      <Row gutter={[16, 16]} className="stats-row">
        <Col xs={12} sm={12} md={6}>
          <Card className="stat-card" variant="borderless">
            <div className="stat-card-header">
              <span className="stat-card-label">总收入</span>
              <DollarOutlined className="stat-card-icon" />
            </div>
            <div className="stat-card-value">$45,690</div>
            <div className="stat-card-footer">
              <ArrowUpOutlined style={{ color: "#10b981", fontSize: 12 }} />
              <span className="trend-up">+12.5%</span>
              <span className="trend-label">vs 上月</span>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={6}>
          <Card className="stat-card" variant="borderless">
            <div className="stat-card-header">
              <span className="stat-card-label">订单数</span>
              <ShoppingCartOutlined className="stat-card-icon" />
            </div>
            <div className="stat-card-value">1,234</div>
            <div className="stat-card-footer">
              <ArrowUpOutlined style={{ color: "#10b981", fontSize: 12 }} />
              <span className="trend-up">+8.2%</span>
              <span className="trend-label">vs 上月</span>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={6}>
          <Card className="stat-card" variant="borderless">
            <div className="stat-card-header">
              <span className="stat-card-label">客户数</span>
              <UserOutlined className="stat-card-icon" />
            </div>
            <div className="stat-card-value">856</div>
            <div className="stat-card-footer">
              <ArrowUpOutlined style={{ color: "#10b981", fontSize: 12 }} />
              <span className="trend-up">+5.7%</span>
              <span className="trend-label">vs 上月</span>
            </div>
          </Card>
        </Col>

        <Col xs={12} sm={12} md={6}>
          <Card className="stat-card" variant="borderless">
            <div className="stat-card-header">
              <span className="stat-card-label">增长率</span>
              <RiseOutlined className="stat-card-icon" />
            </div>
            <div className="stat-card-value">23.1%</div>
            <div className="stat-card-footer">
              <ArrowDownOutlined style={{ color: "#ef4444", fontSize: 12 }} />
              <span className="trend-down">-2.4%</span>
              <span className="trend-label">vs 上月</span>
            </div>
          </Card>
        </Col>
      </Row>

      {/* ===== 收入趋势 + 近期订单 ===== */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        {/* 图表 */}
        <Col xs={24} lg={15}>
          <Card
            className="recent-table-card"
            variant="borderless"
            title={<span className="card-title">收入趋势</span>}
            extra={
              <div style={{ display: "flex", gap: 12, fontSize: 12, color: "#94a3b8" }}>
                <span className="stat-card-value chart-inside" style={{ fontSize: 18, marginBottom: 0 }}>
                  $45,690
                </span>
              </div>
            }
          >
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "none",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
                    fontSize: 13,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#revenueGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        {/* 订单表 */}
        <Col xs={24} lg={9}>
          <Card
            className="recent-table-card"
            variant="borderless"
            title={<span className="card-title">近期订单</span>}
          >
            <Table
              columns={columns}
              dataSource={recentOrders}
              pagination={false}
              size="small"
              showHeader={false}
              scroll={{ y: 260 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ===== 销售概览 + 产品列表 ===== */}
      <Row gutter={[16, 16]}>
        <Col xs={24} md={14}>
          <Card
            className="sales-overview-card"
            variant="borderless"
            title={<span className="card-title">销售概览</span>}
          >
            <div style={{ display: "flex", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ width: 180, height: 180, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="sales-legend" style={{ flex: 1, flexDirection: "column", gap: 10, margin: 0 }}>
                {pieData.map((item) => (
                  <div className="legend-item" key={item.name} style={{ justifyContent: "flex-start" }}>
                    <span className="legend-dot" style={{ background: item.color }} />
                    <span className="legend-name">{item.name}</span>
                    <span className="legend-value">{item.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </Col>

        <Col xs={24} md={10}>
          <Card
            className="sales-overview-card"
            variant="borderless"
            title={<span className="card-title">Top 产品</span>}
          >
            <div className="product-list-header">
              <span>产品</span>
              <span>占比</span>
              <span>收入</span>
            </div>
            {products.map((p) => (
              <div className="product-list-item" key={p.name}>
                <span className="product-name">
                  <span className="product-icon">{p.icon}</span>
                  {p.name}
                </span>
                <span className="product-percent">
                  <div className="percent-bar-bg">
                    <div className="percent-bar-fill" style={{ width: `${p.percent}%`, background: p.color }} />
                  </div>
                  {p.percent}%
                </span>
                <span className="product-earnings">{p.earnings}</span>
              </div>
            ))}
          </Card>
        </Col>
      </Row>
    </div>
  );
};

export default Dashboard;
