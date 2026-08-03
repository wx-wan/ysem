import React, { useState, useMemo, useEffect } from 'react';
import { Avatar, Empty, Typography, Tag, Pagination, ConfigProvider, theme, message } from 'antd';
import AppModal from '../../AppModal';
import {
  DollarOutlined,
  ShoppingCartOutlined,
  ClockCircleOutlined,
  EditOutlined,
  SwapOutlined,
  RollbackOutlined,
  CloseOutlined,
  MailOutlined,
  PhoneOutlined,
  WechatOutlined,
  EnvironmentOutlined,
  UserOutlined,
  NumberOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Customer, customerApi } from '../../../api/customers';
import { fetchCustomerDetail, setDetailCache } from '../../../utils/customerCache';
import { getGrade } from '../shared/utils';
import { getCustomerTier } from '../shared/customerTier';
import { findCountry } from '../../../data/countries';
import FlagIcon from '../../FlagIcon';
import TagSelector from '../../TagSelector';
import CustomerEditDrawer from './CustomerEditDrawer';

const { Text } = Typography;

interface CustomerDetailModalProps {
  open: boolean;
  customer: Customer | null;
  /** 完整客户列表，用于计算「当天序号」生成客户编码 */
  customerList?: Customer[];
  onClose: () => void;
  onTransfer?: (customer: Customer) => void;
  onRelease?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
  onAddPipeline?: (customer: Customer) => void;
  onCreateOrder?: (customer: Customer) => void;
  /** 切换重点客户成功后由父级刷新数据 */
  onToggleKeyAccount?: (customer: Customer) => void;
  /** 打开详情时 getById 异步补充完整数据，仅更新弹窗自身，不回写列表（避免污染列表聚合字段） */
  onDetailLoaded?: (customer: Customer) => void;
  /** 抽屉编辑保存成功后由父级同步数据 */
  onSaved?: (customer: Customer) => void;
  /** 标签变更：仅传入客户 id 与最新的标签字符串，由父级做最小化同步 */
  onTagsChanged?: (id: string, tags: string) => void;
}

/** 模拟商机数据（后续替换为真实 API 数据） */
interface MockPipelineItem {
  id: string;
  code: string;
  inqCode: string;
  name: string;
  spec: string;
  amount: number;
  currency: string;
  pcs: number;
  unitPrice: string;
  status: string;
  statusColor: string;
  ownerName: string;
  validUntil: string;
}

function useMockPipelines(customer: Customer | null): MockPipelineItem[] {
  return useMemo(() => {
    if (!customer) return [];
    const base: MockPipelineItem[] = [
      {
        id: '1', code: 'QT-2024-0528', inqCode: 'INQ-2024-0336',
        name: customer.companyName || '-', spec: '工具收纳墙挂板（SKU：TWP-660）',
        amount: 38000, currency: 'EUR', pcs: 10000, unitPrice: 'EUR 3.8',
        status: '编辑', statusColor: (customer.pipelineAmount ?? 0) > 20000 ? '#7c3aed' : '#1677ff',
        ownerName: customer.owner?.realName || '陈伟', validUntil: '2024-09-19',
      },
      {
        id: '2', code: 'QT-2024-0528', inqCode: 'INQ-2024-0336',
        name: customer.companyName || '-', spec: '工具收纳墙挂板（SKU：TWP-660）',
        amount: 38000, currency: 'EUR', pcs: 10000, unitPrice: 'EUR 3.8',
        status: '编辑', statusColor: '#7c3aed',
        ownerName: customer.owner?.realName || '陈伟', validUntil: '2024-09-19',
      },
      {
        id: '3', code: 'QT-2024-0528', inqCode: 'INQ-2024-0336',
        name: customer.companyName || '-',
        spec: '工具收纳墙挂板（SKU：TWP-660）含CE认证费用，FOB深圳',
        amount: 38000, currency: 'EUR', pcs: 10000, unitPrice: 'EUR 3.8',
        status: '编辑', statusColor: '#7c3aed',
        ownerName: customer.owner?.realName || '陈伟', validUntil: '2024-09-19',
      },
    ];
    return base;
  }, [customer]);
}

// ============================================================
// 主组件
// ============================================================
const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  open, customer, customerList = [], onClose, onTransfer, onRelease, onDelete, onAddPipeline, onCreateOrder, onToggleKeyAccount, onSaved, onTagsChanged, onDetailLoaded,
}) => {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'orders' | 'activities'>('pipeline');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 3;

  // 抽屉编辑状态
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);

  const ct = getCustomerTier(customer);

  // 标签本地自治：内部维护状态并自行调用 API，避免依赖外部对象重建
  const [localTags, setLocalTags] = useState<string>(typeof customer?.tags === 'string' ? customer.tags : '');
  useEffect(() => {
    setLocalTags(typeof customer?.tags === 'string' ? customer.tags : '');
  }, [customer?.id, customer?.tags]);

  // 客户编码：CUS-{创建日期 YYMMDD}-{当天序号}
  const customerCode = useMemo(() => {
    if (!customer?.createdAt) return `CUS-${String(customer?.id ?? 0).padStart(4, '0')}`;
    const created = dayjs(customer.createdAt);
    const datePart = created.format('YYMMDD');
    // 当天序号：同一创建日期的客户按 createdAt 升序的排名
    const sameDay = customerList
      .filter((c) => c.createdAt && dayjs(c.createdAt).format('YYMMDD') === datePart)
      .sort((a, b) => dayjs(a.createdAt!).valueOf() - dayjs(b.createdAt!).valueOf());
    const seq = sameDay.findIndex((c) => c.id === customer.id) + 1;
    return `CUS-${datePart}-${seq}`;
  }, [customer?.id, customer?.createdAt, customerList]);

  // 逻辑标签：未成交客户 / 已成交客户 / 本年度新客 / 往年老客
  const logicTag = useMemo(() => {
    if (!customer) return '';
    const hasOrder = Boolean(customer.firstOrderDate);
    const createdYear = customer.createdAt ? dayjs(customer.createdAt).year() : 0;
    const thisYear = dayjs().year();
    if (hasOrder) return '已成交客户';
    if (createdYear === thisYear) return '本年度新客';
    if (createdYear > 0 && createdYear < thisYear) return '往年老客';
    return '未成交客户';
  }, [customer]);

  // 列表项不含 owner/pipelines，打开后用 getById 异步补充完整数据。
  // 放在 Modal 内部 effect，使父组件的点击处理保持同步、零 async 阻塞，点击即弹窗。
  // 经前端缓存 fetchCustomerDetail：命中则直接复用，避免重复请求。
  useEffect(() => {
    if (!customer?.id) return;
    let cancelled = false;
    fetchCustomerDetail(customer.id).then((data) => {
      if (!cancelled && data) {
        onDetailLoaded?.(data);
      }
    }).catch(() => { /* 忽略，保留列表项数据渲染 */ });
    return () => { cancelled = true; };
    // 仅在 customer.id 变化时触发（打开新客户时）
  }, [customer?.id]);

  /** 取公司名/联系人首字母作为头像文字 */
  const getInitials = (name: string) => {
    const cleaned = name.replace(/[^a-zA-Z\u4e00-\u9fa5]/g, '');
    if (!cleaned) return '?';
    if (/[\u4e00-\u9fa5]/.test(cleaned)) return cleaned.charAt(0);
    return cleaned.slice(0, 2).toUpperCase();
  };

  const isPublic = !customer?.ownerId;

  // 左侧头部文字色：浅色渐变用深色文字，深色渐变用白色
  const headerText = ct.headerTextDark ? token.colorTextHeading : token.colorWhite;
  const headerTextSub = ct.headerTextDark ? token.colorTextSecondary : 'rgba(255,255,255,0.85)';
  const headerTextFaint = ct.headerTextDark ? token.colorTextTertiary : 'rgba(255,255,255,0.7)';

  /** 信息行：icon + 文字 左对齐（适配彩色背景） */
  const InfoRow: React.FC<{ icon: React.ReactNode; value: string | undefined; prefixIcon?: React.ReactNode }> = ({ icon, value, prefixIcon }) => {
    if (!value) return null;
    return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
      <span style={{ fontSize: 13, color: headerTextFaint, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: headerTextSub, wordBreak: 'break-all' }}>
        {prefixIcon}
        {value}
      </span>
    </div>
    );
  };

  const mockPipelines = useMockPipelines(customer);

  // 分页切片
  const paginatedData = useMemo(() => {
    let data: any[] = [];
    switch (activeTab) {
      case 'pipeline': data = mockPipelines; break;
      case 'orders': data = []; break;
      case 'activities': data = []; break;
    }
    const start = (currentPage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [activeTab, currentPage, mockPipelines]);

  const totalCount = activeTab === 'pipeline' ? mockPipelines.length : 0;

  // ---- 圆形操作按钮样式工厂 ----
  const circleBtnStyle = (bg: string): React.CSSProperties => ({
    width: 36, height: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: '50%', cursor: 'pointer',
    backgroundColor: bg, color: token.colorWhite,
    fontSize: 15, lineHeight: 1, transition: 'all 0.22s ease', padding: 0, flexShrink: 0,
  });

  // ---- 格式化金额 ----
  const fmtAmt = (v: number, cur = 'EUR') =>
    `${cur} ${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

  // ---- tab 配置 ----
  const tabOptions = [
    { key: 'pipeline' as const, label: '商机记录', count: mockPipelines.length },
    { key: 'orders' as const, label: '订单记录', count: customer?.orders?.length ?? 0 },
    { key: 'activities' as const, label: '活动记录', count: customer?.activities?.length ?? 0 },
  ];

  // ---- 类型标签文字 ----
  const typeLabel = (() => {
    if (!customer) return '';
    const grade = getGrade(customer);
    const cy = new Date().getFullYear().toString();
    if (!customer.ownerId) return '公海客户';
    if (customer.firstOrderDate)
      return customer.firstOrderDate.startsWith(cy) ? '未成交客户 · 准成交' : '未成交客户 · 高意向';
    switch (grade.grade) {
      case 'A': return '未成交客户 · 准成交';
      case 'B': return '未成交客户 · 高意向';
      case 'C': return '未成交客户 · 中意向';
      case 'D': return '未成交客户 · 低意向';
      default: return '未成交客户';
    }
  })();

  // ---- 列表项卡片渲染 ----
  const renderListItem = (item: MockPipelineItem) => (
    <div
      key={item.id}
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 14, padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
        transition: 'all 0.22s ease', cursor: 'pointer',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 16px ${ct.primary}18`;
        e.currentTarget.style.borderColor = ct.primary + '40';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = token.colorBorderSecondary;
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* 左侧：编号 + 审核标签 */}
      <div style={{ flexShrink: 0, minWidth: 160 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text strong style={{ fontSize: 13, color: ct.primary }}>{item.code}</Text>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>→</span>
          <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{item.inqCode}</Text>
        </div>
        <div style={{ marginTop: 4 }}>
          <Tag color={ct.primary} style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
            客户审核
          </Tag>
        </div>
      </div>

      {/* 中间：名称 + 规格 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: token.colorTextHeading }}>🏢</span>
          <Text strong ellipsis style={{ fontSize: 13, color: token.colorTextHeading }}>{item.name}</Text>
        </div>
        <Text ellipsis style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 3, display: 'block' }}>
          {item.spec}
        </Text>
      </div>

      {/* 右侧：报价金额 */}
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 110 }}>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>报价金额</div>
        <Text strong style={{ fontSize: 16, color: token.colorTextHeading }}>{fmtAmt(item.amount, item.currency)}</Text>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
          {item.pcs.toLocaleString()} PCS × {item.unitPrice}
        </div>
      </div>

      {/* 最右：状态 + 负责人 + 日期 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, minWidth: 90 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Avatar size={26} style={{ backgroundColor: item.statusColor, fontSize: 12, fontWeight: 700 }}>
            {item.ownerName.charAt(0)}
          </Avatar>
          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{item.ownerName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
          <Tag color={item.statusColor} style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
            {item.status}
          </Tag>
          <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>发送</Text>
        </div>
        <Text style={{ fontSize: 11, color: token.colorTextTertiary, alignSelf: 'flex-end' }}>
          有效至 {item.validUntil}
        </Text>
      </div>
    </div>
  );

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <>
      <AppModal
        open={open}
        onClose={onClose}
        width={980}
        centered
        closable={false}
        maskClosable={!editDrawerOpen}
        bodyPadding={0}
        style={{ borderRadius: 20 }}
        bodyStyle={{ overflow: 'hidden', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
      >
        {customer && (
          <div style={{ display: 'flex', minHeight: 520, background: token.colorBgContainer }}>
            {/* ==================== 左侧：上半彩色 + 下半白色标签区 ==================== */}
            <div
              style={{
                width: 280, minWidth: 280,
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: 12, borderRadius: '20px 0 0 20px', overflow: 'hidden',
                background: token.colorBgContainer,
              }}
            >
              {/* 上半：彩色基础信息（四角圆角） */}
              <div
                style={{
                  background: ct.headerGradient, padding: '20px 20px',
                  display: 'flex', flexDirection: 'column',
                  position: 'relative', overflow: 'hidden',
                  flex: 1, borderRadius: 16,
                }}
              >
                {/* 头像（客户名称首字母） */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{
                    width: 72, height: 72, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.22)', color: headerText, fontSize: 26, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
                  }}>
                    {getInitials(customer.companyName || customer.contactName || '-')}
                  </div>

                  {/* 职位 */}
                  {customer.position && (
                    <p style={{ margin: '10px 0 0', fontSize: 13, color: headerTextSub, lineHeight: 1.4 }}>
                      {customer.position}
                    </p>
                  )}

                  {/* 公司名 */}
                  <h2 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800, color: headerText, lineHeight: 1.3 }}>
                    {customer.companyName || '-'}
                  </h2>

                  {/* 逻辑标签 */}
                  {logicTag && (
                    <span style={{
                      marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5,
                      border: `1px solid rgba(255,255,255,0.35)`, color: headerText,
                      fontSize: 12, fontWeight: 600, padding: '4px 14px', borderRadius: 8,
                      background: 'rgba(255,255,255,0.13)',
                    }}>
                      {logicTag}
                    </span>
                  )}
                </div>

                {/* 信息列表：联系人 + 邮箱 / 电话 / 微信 / 地区（带国旗） */}
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <InfoRow icon={<UserOutlined style={{ fontSize: 14 }} />} value={customer.contactName} />
                  <InfoRow icon={<MailOutlined style={{ fontSize: 14 }} />} value={customer.email} />
                  <InfoRow icon={<PhoneOutlined style={{ fontSize: 14 }} />} value={customer.phone} />
                  <InfoRow icon={<WechatOutlined style={{ fontSize: 14 }} />} value={customer.wechat} />
                  <InfoRow
                    icon={<EnvironmentOutlined style={{ fontSize: 14 }} />}
                    value={customer.country ? (findCountry(customer.country)?.zh ?? customer.country) : ''}
                    prefixIcon={customer.country ? <FlagIcon country={customer.country} style={{ width: 20, height: 14, borderRadius: 2 }} /> : undefined}
                  />
                </div>
              </div>

              {/* 下半：白色标签区（四角圆角，无额外内距，仅随外圈留白） */}
              <div
                style={{
                  background: token.colorBgContainer,
                  borderRadius: 16,
                }}
              >
                <TagSelector
                  value={localTags}
                  onChange={(v) => {
                    if (!customer?.id) return;
                    const id = customer.id;
                    // 先本地更新显示，再写后端，组件自治
                    setLocalTags(v);
                    customerApi
                      .updateTags(id, v)
                      .then((res: any) => {
                        const updated = res?.data?.data;
                        if (!updated) return;
                        setDetailCache({ ...customer, id, tags: updated.tags });
                        onTagsChanged?.(id, updated.tags);
                      })
                      .catch(() => {
                        // 失败回滚本地显示
                        setLocalTags(typeof customer.tags === 'string' ? customer.tags : '');
                        message.error('标签更新失败');
                      });
                  }}
                  color={ct.primary || token.colorPrimary}
                  placeholder="添加标签"
                />
              </div>
            </div>

            {/* ==================== 右侧：内容区 ==================== */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* 右上操作栏：tab + 图标 + 负责人 */}
              <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                {/* 左：标题 + 编辑按钮 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: token.colorTextHeading }}>
                      {customer.companyName}
                    </h2>
                    {customer.contactName && (
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: token.colorTextSecondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        联系人：{customer.contactName}
                      </p>
                    )}
                  </div>
                  {/* 编辑按钮 → 打开右侧抽屉 */}
                  <button
                    type="button"
                    onClick={() => setEditDrawerOpen(true)}
                    style={{
                      height: 32,
                      padding: '0 14px',
                      border: `1px solid ${token.colorBorder}`,
                      borderRadius: 8,
                      background: 'transparent',
                      color: token.colorTextSecondary,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 13,
                      transition: 'all 0.22s ease',
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = ct.primary;
                      e.currentTarget.style.color = ct.primary;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = token.colorBorder;
                      e.currentTarget.style.color = token.colorTextSecondary;
                    }}
                  >
                    <EditOutlined /> 编辑
                  </button>
                </div>

                {/* 右：负责人 + 操作图标 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {/* 负责人信息 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar size={36} style={{ backgroundColor: ct.primary, fontSize: 15, fontWeight: 700 }}>
                      {isPublic ? '公' : ((customer.owner?.realName || customer.owner?.username || '?').charAt(0))}
                    </Avatar>
                    <div>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>负责人</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: token.colorTextHeading, lineHeight: 1.3 }}>
                        {isPublic ? '公海' : (customer.owner?.realName || customer.owner?.username || '-')}
                      </div>
                      <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                        {customer.owner?.role?.code || 'business'}
                      </div>
                    </div>
                  </div>

                  {/* 操作图标 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {onTransfer && (
                      <button type="button" onClick={() => onTransfer(customer)} title="转交"
                        style={circleBtnStyle(ct.primaryLight)}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.boxShadow = 'none'; }}>
                        <SwapOutlined style={{ color: ct.primary }} />
                      </button>
                    )}
                    {onRelease && (
                      <button type="button" onClick={() => onRelease(customer)} title="释放"
                        style={circleBtnStyle(ct.primaryLight)}
                        onMouseEnter={(e) => { (e.target as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onMouseLeave={(e) => { (e.target as HTMLElement).style.boxShadow = 'none'; }}>
                        <RollbackOutlined style={{ color: ct.primary }} />
                      </button>
                    )}
                    <button type="button" onClick={onClose} title="关闭"
                      style={circleBtnStyle(token.colorFillQuaternary)}
                      onMouseEnter={(e) => { (e.target as HTMLElement).style.backgroundColor = token.colorFillSecondary; }}
                      onMouseLeave={(e) => { (e.target as HTMLElement).style.backgroundColor = token.colorFillQuaternary; }}>
                      <CloseOutlined style={{ color: token.colorTextSecondary }} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 卡片列表区域 */}
              <div style={{ flex: 1, padding: '20px 24px 0', overflow: 'auto', minHeight: 280 }}>
                {paginatedData.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {paginatedData.map(renderListItem)}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
                    <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                      {activeTab === 'pipeline' && '暂无商机记录'}
                      {activeTab === 'orders' && '暂无订单记录'}
                      {activeTab === 'activities' && '暂无活动记录'}
                    </span>
                  } style={{ padding: '60px 0' }} />
                )}
              </div>

              {/* 底部：分页器 + 日期 */}
              <div style={{ padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: token.colorBgContainer }}>
                <ConfigProvider
                  theme={{
                    token: { colorPrimary: ct.primary },
                    components: {
                      Pagination: {
                        itemActiveBg: ct.primary,
                        itemActiveColor: '#fff',
                      },
                    },
                  }}
                >
                  <Pagination
                    current={currentPage}
                    total={totalCount}
                    pageSize={pageSize}
                    size="small"
                    showSizeChanger={false}
                    onChange={(page) => setCurrentPage(page)}
                    styles={{ item: { borderRadius: 8 } }}
                  />
                </ConfigProvider>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{dayjs().format('YYYY-MM-DD')}</Text>
                  <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>{customerCode}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </AppModal>

      {/* 右侧编辑抽屉 */}
      <CustomerEditDrawer
        open={editDrawerOpen}
        customer={customer}
        onClose={() => setEditDrawerOpen(false)}
        onSaved={(updated) => {
          // 用当前 customer 兜底补全所有字段，仅更新 updated 实际包含的字段，避免关联信息丢失
          const merged = { ...customer, ...updated };
          setDetailCache(merged);
          onSaved?.(merged);
          setEditDrawerOpen(false);
        }}
      />
    </>
  );
};

export default CustomerDetailModal;
