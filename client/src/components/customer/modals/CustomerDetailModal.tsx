import React, { useState, useMemo, useEffect } from 'react';
import { Avatar, Empty, Typography, Tag, Pagination, ConfigProvider, theme, App, message, Skeleton } from 'antd';
import AppModal from '../../AppModal';
import {
  PlusOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  ClockCircleOutlined,
  EditOutlined,
  DeleteOutlined,
  SwapOutlined,
  RollbackOutlined,
  CloseOutlined,
  MailOutlined,
  PhoneOutlined,
  WechatOutlined,
  UserOutlined,
  IdcardOutlined,
  NumberOutlined,
  MoneyCollectOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Customer, Order, CustomerActivity, customerApi } from '../../../api/customers';
import { fetchCustomerDetail, setDetailCache } from '../../../utils/customerCache';
import Price from '../../common/Price';
import { getCustomerLogicLabel } from '../shared/utils';
import PurchaseIntentTag from '../shared/PurchaseIntentTag';
import { getCustomerTier, getAvatarColor } from '../shared/customerTier';
import CountrySelect from '../../CountrySelect';
import TagSelector from '../../TagSelector';
import CustomerEditDrawer from './CustomerEditDrawer';
import KeyAccountStar from '../../KeyAccountStar';
import SegmentedTabBar from '../../common/SegmentedTabBar';
import CustomerOverview from './CustomerOverview';

const { Text } = Typography;

interface CustomerDetailModalProps {
  open: boolean;
  customer: Customer | null;
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
  /** 商机操作回调 */
  onEditPipeline?: (pipeline: RealPipeline) => void;
  onConvertPipeline?: (pipeline: RealPipeline) => void;
  onDeletePipeline?: (pipeline: RealPipeline) => void;
  /** 详情版本号：商机编辑/转化/删除后递增，触发 modal 内部重新拉取客户数据 */
  detailVersion?: number;
}

/** 真实商机记录（来自 getById 的 pipelines，非模拟数据） */
interface RealPipeline {
  id: string;
  title?: string;
  companyName?: string;
  estimatedAmount?: number | null;
  probability?: number | null;
  orderStatus?: string | null;
  sampleStatus?: string | null;
  estimatedCloseDate?: string | null;
  assignee?: { id: string; realName?: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

/** 销售记录统一条目：订单 + 商机管道，按创建时间混合排序 */
type UnifiedRecord =
  | { kind: 'order'; data: Order }
  | { kind: 'pipeline'; data: RealPipeline };

// ============================================================
// 主组件
// ============================================================
const CustomerDetailModal: React.FC<CustomerDetailModalProps> = ({
  open, customer, onClose, onTransfer, onRelease, onDelete, onAddPipeline, onCreateOrder, onToggleKeyAccount, onSaved, onTagsChanged, onDetailLoaded,
  onEditPipeline, onConvertPipeline, onDeletePipeline, detailVersion,
}) => {
  const { modal } = App.useApp();
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'orders' | 'activities'>('pipeline');
  const [currentPage, setCurrentPage] = useState(1);
  // 概览 tab 不分页；销售记录每页 5 条（首栏留给添加区块）；跟进动态每页 8 条
  const pageSize = activeTab === 'pipeline' ? 3 : activeTab === 'orders' ? 5 : 8;

  // 抽屉编辑状态
  const [editDrawerOpen, setEditDrawerOpen] = useState(false);

  // 详情异步加载状态（open 时由 getById 补充完整数据）
  // 用正向标记：初始 false，仅 fetch 成功后才置 true。避免首帧显示"暂无记录"的中间态
  const [detailLoaded, setDetailLoaded] = useState(false);

  // 商机列表项悬浮态（控制侧边操作按钮滑出）
  const [hoveredPipelineId, setHoveredPipelineId] = useState<string | null>(null);

  const ct = getCustomerTier(customer);

  // 头像/标签主题色：与卡片视图（CustomerCard）保持一致
  const avatarBg = getAvatarColor(ct.tier, token);

  // 标签本地自治：内部维护状态并自行调用 API，避免依赖外部对象重建
  const [localTags, setLocalTags] = useState<string>(typeof customer?.tags === 'string' ? customer.tags : '');
  useEffect(() => {
    setLocalTags(typeof customer?.tags === 'string' ? customer.tags : '');
  }, [customer?.id, customer?.tags]);

  // 客户编码：CUS-{创建日期 YYMMDD}-{当天序号}
  const customerCode = customer?.customerCode || '-';

  // 逻辑标签：统一复用 PurchaseIntentTag 组件（含成交状态前缀 + 采购意向），卡片视图与详情视图共用同一套逻辑
  const logicTag = useMemo(() => (customer ? getCustomerLogicLabel(customer) : ''), [customer]);

  // 列表项不含 owner/pipelines，打开后用 getById 异步补充完整数据。
  // 放在 Modal 内部 effect，使父组件的点击处理保持同步、零 async 阻塞，点击即弹窗。
  // 经前端缓存 fetchCustomerDetail：命中则直接复用，避免重复请求。
  useEffect(() => {
    // 仅在弹窗打开且客户存在时拉取；依赖加入 open，
    // 保证「同一客户二次打开」也会重新补充完整数据（列表项不含 orders/activities）
    if (!open || !customer?.id) {
      setDetailLoaded(false);
      return;
    }
    let cancelled = false;
    setDetailLoaded(false);
    fetchCustomerDetail(customer.id).then((data) => {
      if (!cancelled && data) {
        onDetailLoaded?.(data);
        setDetailLoaded(true);
      }
    }).catch(() => { /* 忽略，保留列表项数据渲染 */ });
    return () => { cancelled = true; };
    // 依赖 open：每次打开（含同一客户二次打开）都重新补充详情，避免数据丢失
  }, [open, customer?.id, detailVersion]);

  /** 删除客户：二次确认后交由父级执行 */
  const handleDelete = () => {
    if (!customer) return;
    modal.confirm({
      title: '删除客户',
      content: `确定要删除客户「${customer.companyName || customer.contactName || '-'}」吗？删除后不可恢复。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      centered: true,
      onOk: () => {
        onDelete?.(customer);
        onClose();
      },
    });
  };

  const isPublic = !customer?.ownerId;

  // 左侧头部文字色：浅色渐变用深色文字，深色渐变用白色
  const headerText = ct.headerTextDark ? token.colorTextHeading : token.colorWhite;
  const headerTextSub = ct.headerTextDark ? token.colorTextSecondary : 'rgba(255,255,255,0.85)';
  const headerTextFaint = ct.headerTextDark ? token.colorTextTertiary : 'rgba(255,255,255,0.7)';

  /** 信息面板操作按钮（彩色区块内的半透明按钮）：补 default/hover/active/focus 标准态 */
  const panelBtnStyle: React.CSSProperties = {
    width: 32, height: 32, borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'rgba(255,255,255,0.18)',
    color: headerText, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, transition: 'background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease',
    outline: 'none',
  };

  /** 模块小标题：主色竖条 + 文案（去除中文 uppercase 死样式） */
  const SectionTitle: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color }) => (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 12,
        fontSize: 13, fontWeight: 700, letterSpacing: '0.01em',
        color: token.colorTextSecondary,
      }}
    >
      <span style={{ width: 3, height: 13, borderRadius: 2, background: color || avatarBg, display: 'inline-block' }} />
      {children}
    </div>
  );

  /** 信息行：icon + 文字 左对齐（适配彩色背景） */
  const InfoRow: React.FC<{ icon: React.ReactNode; value: string | undefined }> = ({ icon, value }) => {
    if (!value) return null;
    return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 22 }}>
      <span style={{ fontSize: 13, color: headerTextFaint, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: headerTextSub, wordBreak: 'break-all', letterSpacing: '0.01em' }}>
        {value}
      </span>
    </div>
    );
  };

  const realPipelines = (customer?.pipelines || []) as RealPipeline[];

  // 分页切片
  const paginatedData = useMemo(() => {
    let data: any[] = [];
    switch (activeTab) {
      case 'pipeline': data = realPipelines; break;
      case 'orders': {
        const orders: UnifiedRecord[] = (customer?.orders || []).map(o => ({ kind: 'order', data: o }));
        const orderPipelines: UnifiedRecord[] = realPipelines.map(p => ({ kind: 'pipeline', data: p }));
        data = [...orders, ...orderPipelines].sort(
          (a, b) => new Date(b.data.createdAt || '').getTime() - new Date(a.data.createdAt || '').getTime()
        );
      } break;
      case 'activities': data = customer?.activities || []; break;
    }
    const start = (currentPage - 1) * pageSize;
    return data.slice(start, start + pageSize);
  }, [activeTab, currentPage, realPipelines, customer?.orders, customer?.activities]);

  const totalCount =
    activeTab === 'pipeline' ? realPipelines.length :
    activeTab === 'orders' ? ((customer?.orders?.length ?? 0) + realPipelines.length) :
    activeTab === 'activities' ? (customer?.activities?.length ?? 0) : 0;

  // ---- 圆形操作按钮样式工厂 ----
  const circleBtnStyle = (bg: string): React.CSSProperties => ({
    width: 36, height: 36,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', borderRadius: '50%', cursor: 'pointer',
    backgroundColor: bg, color: token.colorWhite,
    fontSize: 15, lineHeight: 1, transition: 'all 0.22s ease', padding: 0, flexShrink: 0,
  });

  // ---- tab 配置 ----
  const tabOptions = [
    { key: 'pipeline' as const, label: '概览', count: realPipelines.length },
    { key: 'orders' as const, label: '销售记录', count: customer?.orders?.length ?? 0 },
    { key: 'activities' as const, label: '跟进动态', count: customer?.activities?.length ?? 0 },
  ];

  // ---- 类型标签文字 ----
  // ---- 商机记录项渲染（真实数据） ----
  const renderPipelineItem = (item: RealPipeline) => {
    const ownerName = item.assignee?.realName || customer?.owner?.realName || '未分配';
    const stage = item.orderStatus || item.sampleStatus || '商机';
    const stageColor = item.orderStatus ? '#16a34a' : item.sampleStatus ? '#d97706' : ct.primary;
    const isHovered = hoveredPipelineId === item.id;

    const actionBtnBase: React.CSSProperties = {
      width: 32, height: 32, borderRadius: 8, border: `1px solid ${token.colorBorderSecondary}`,
      background: token.colorBgContainer, cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, transition: 'all 0.18s ease', outline: 'none', color: token.colorTextSecondary,
    };

    return (
      <div
        key={item.id}
        style={{ ...listCardBase, display: 'flex', alignItems: 'center', gap: 16, cursor: 'default', position: 'relative', overflow: 'hidden' }}
        onMouseEnter={(e) => { listCardHover(e); setHoveredPipelineId(item.id); }}
        onMouseLeave={(e) => { listCardLeave(e); setHoveredPipelineId(null); }}
      >
        {/* 左侧：阶段标签 */}
        <div style={{ flexShrink: 0, minWidth: 80 }}>
          <Tag color={stageColor} style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
            {stage}
          </Tag>
          {item.probability != null && (
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 6 }}>
              {item.probability || '低意向'}
            </div>
          )}
        </div>

        {/* 中间：标题 + 创建时间 + 预计成交 */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong ellipsis style={{ fontSize: 13, color: token.colorTextHeading }}>{item.title || item.companyName || '-'}</Text>
          {item.createdAt && (
            <Text ellipsis style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 3, display: 'block' }}>
              <ClockCircleOutlined style={{ marginRight: 4, fontSize: 10 }} />
              {dayjs(item.createdAt).format('YYYY-MM-DD HH:mm')}
            </Text>
          )}
          {item.estimatedCloseDate && (
            <Text ellipsis style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 2, display: 'block' }}>
              预计成交 {item.estimatedCloseDate}
            </Text>
          )}
        </div>

        {/* 右侧：预估金额 */}
        <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 110 }}>
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>预估金额</div>
          <Text strong style={{ fontSize: 16, color: token.colorTextHeading }}><Price value={item.estimatedAmount} /></Text>
        </div>

        {/* 负责人 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0, minWidth: 90 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar size={26} style={{ backgroundColor: stageColor, fontSize: 12, fontWeight: 700 }}>
              {ownerName.charAt(0)}
            </Avatar>
            <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{ownerName}</span>
          </div>
        </div>

        {/* 侧边操作按钮组（hover 时滑出） */}
        <div
          style={{
            position: 'absolute',
            right: isHovered ? 8 : -108,
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            gap: 6,
            transition: 'right 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
            padding: '4px',
            borderRadius: 10,
            background: token.colorBgContainer,
            boxShadow: isHovered ? `0 2px 12px ${ct.primary}1a` : 'none',
          }}
        >
          {onEditPipeline && (
            <button type="button" title="编辑商机"
              style={actionBtnBase}
              onClick={(e) => { e.stopPropagation(); onEditPipeline(item); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = ct.primaryBg; e.currentTarget.style.borderColor = ct.primary + '40'; e.currentTarget.style.color = ct.primary; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = token.colorBgContainer; e.currentTarget.style.borderColor = token.colorBorderSecondary; e.currentTarget.style.color = token.colorTextSecondary; }}
            >
              <EditOutlined />
            </button>
          )}
          {onConvertPipeline && (
            <button type="button" title="转为订单"
              style={actionBtnBase}
              onClick={(e) => { e.stopPropagation(); onConvertPipeline(item); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#e6f7e6'; e.currentTarget.style.borderColor = '#16a34a40'; e.currentTarget.style.color = '#16a34a'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = token.colorBgContainer; e.currentTarget.style.borderColor = token.colorBorderSecondary; e.currentTarget.style.color = token.colorTextSecondary; }}
            >
              <RiseOutlined />
            </button>
          )}
          {onDeletePipeline && (
            <button type="button" title="删除商机"
              style={actionBtnBase}
              onClick={(e) => { e.stopPropagation(); onDeletePipeline(item); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#fff1f0'; e.currentTarget.style.borderColor = '#ff4d4f40'; e.currentTarget.style.color = '#ff4d4f'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = token.colorBgContainer; e.currentTarget.style.borderColor = token.colorBorderSecondary; e.currentTarget.style.color = token.colorTextSecondary; }}
            >
              <DeleteOutlined />
            </button>
          )}
        </div>
      </div>
    );
  };

  // ---- 列表项卡片基础样式（统一圆角 16 与 hover/focus 标准态） ----
  const listCardBase: React.CSSProperties = {
    background: token.colorBgContainer,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: 16, padding: '16px 20px',
    transition: 'all 0.2s ease',
  };
  const listCardHover = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = `0 6px 20px ${ct.primary}14`;
    e.currentTarget.style.borderColor = ct.primary + '40';
    e.currentTarget.style.transform = 'translateY(-1px)';
  };
  const listCardLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = 'none';
    e.currentTarget.style.borderColor = token.colorBorderSecondary;
    e.currentTarget.style.transform = 'translateY(0)';
  };

  // ---- 订单记录项渲染（真实数据） ----
  const renderOrderItem = (item: Order) => (
    <div
      key={item.id}
      style={{ ...listCardBase, display: 'flex', alignItems: 'center', gap: 16 }}
      onMouseEnter={listCardHover}
      onMouseLeave={listCardLeave}
    >
      <div style={{ flexShrink: 0, minWidth: 110 }}>
        <Tag color="#16a34a" style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
          {item.status || '订单'}
        </Tag>
        {item.orderNo && (
          <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 6 }}>{item.orderNo}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text strong style={{ fontSize: 13, color: token.colorTextHeading }}>订单记录</Text>
        {item.orderDate && (
          <Text ellipsis style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 3, display: 'block' }}>
            下单日期 {item.orderDate}
          </Text>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 110 }}>
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>订单金额</div>
        <Text strong style={{ fontSize: 16, color: token.colorTextHeading }}><Price value={item.amountCNY} /></Text>
      </div>
    </div>
  );

  // ---- 活动记录项渲染（真实数据） ----
  const ACTIVITY_ACTION: Record<string, string> = {
    CLAIM: '认领', RELEASE: '释放到公海', CREATED: '创建', UPDATED: '更新', KEY_TOGGLE: '重点客户切换', INTENT_CHANGE: '意向变更',
  };
  const renderActivityItem = (item: CustomerActivity) => (
    <div
      key={item.id}
      style={{ ...listCardBase, display: 'flex', alignItems: 'center', gap: 12 }}
      onMouseEnter={listCardHover}
      onMouseLeave={listCardLeave}
    >
      <Tag color="blue" style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
        {ACTIVITY_ACTION[item.action] || item.action}
      </Tag>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, color: token.colorTextHeading }}>{item.detail || '-'}</Text>
      </div>
      <Text style={{ fontSize: 11, color: token.colorTextTertiary, flexShrink: 0 }}>
        {item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : ''} · {item.createdBy}
      </Text>
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
        width={1200}
        centered
        closable={false}
        maskClosable={!editDrawerOpen}
        bodyPadding={0}
        style={{ borderRadius: 20 }}
        bodyStyle={{ overflow: 'hidden', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
      >
        {customer && (
          <div style={{ display: 'flex', minHeight: 500, background: token.colorBgContainer }}>
            {/* ==================== 左侧：上半彩色 + 下半白色标签区 ==================== */}
            <div
              style={{
                width: 296, minWidth: 296,
                display: 'flex', flexDirection: 'column', gap: 14,
                padding: 16, borderRadius: '20px 0 0 20px', overflow: 'hidden',
                background: token.colorBgContainer,
              }}
            >
              {/* 上半：彩色基础信息（四角圆角，撑满剩余父组件高度，标签模块自然排于下方） */}
              <div
                style={{
                  background: ct.headerGradient, padding: '22px 22px 20px',
                  display: 'flex', flexDirection: 'column',
                  position: 'relative',
                  flex: 1, minHeight: 0,
                  borderRadius: 16,
                }}
              >
                {/* 顶部：采购意向标签（左） + 重点客户星标（右） */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  {customer ? (
                    <PurchaseIntentTag label={logicTag} size="default" style={{
                      backgroundColor: 'rgba(255,255,255,0.2)',
                      color: token.colorWhite,
                    }} />
                  ) : <span />}
                  <KeyAccountStar
                    isKeyAccount={customer.isKeyAccount || false}
                    color="rgba(255,255,255,0.95)"
                    mutedColor="rgba(255,255,255,0.4)"
                    onToggle={() => onToggleKeyAccount?.(customer)}
                  />
                </div>

                {/* 公司名 */}
                <h2 style={{ margin: '16px 0 0', fontSize: 21, fontWeight: 800, color: headerText, lineHeight: 1.32, wordBreak: 'break-word', letterSpacing: '0.01em' }}>
                  {customer.companyName || '-'}
                </h2>

                {/* 国家（与卡片视图一致：旗帜 + 名称·缩写）+ 右：编辑/删除 左右分布 */}
                {customer.country && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 13, color: headerTextSub, letterSpacing: '0.01em' }}>
                      <CountrySelect readOnly value={customer.country} style={{ color: 'inherit' }} />
                    </span>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        title="编辑"
                        onClick={() => setEditDrawerOpen(true)}
                        style={panelBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.34)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; }}
                        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; }}
                        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                        onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,255,255,0.4)'; }}
                        onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <EditOutlined />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={handleDelete}
                        style={panelBtnStyle}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,99,102,0.9)'; e.currentTarget.style.borderColor = 'rgba(255,99,102,0.9)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.35)'; }}
                        onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.92)'; }}
                        onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                        onFocus={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px rgba(255,99,102,0.45)'; }}
                        onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <DeleteOutlined />
                      </button>
                    </div>
                  </div>
                )}

                {/* 联系人信息：联系人 / 职位 / 邮箱 / 电话 / 微信（带 icon） */}
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.16)', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  <InfoRow icon={<UserOutlined style={{ fontSize: 14 }} />} value={customer.contactName} />
                  <InfoRow icon={<IdcardOutlined style={{ fontSize: 14 }} />} value={customer.position} />
                  <InfoRow icon={<MailOutlined style={{ fontSize: 14 }} />} value={customer.email} />
                  <InfoRow icon={<PhoneOutlined style={{ fontSize: 14 }} />} value={customer.phone} />
                  <InfoRow icon={<WechatOutlined style={{ fontSize: 14 }} />} value={customer.wechat} />
                  <InfoRow icon={<MoneyCollectOutlined style={{ fontSize: 14 }} />} value={customer.firstOrderDate || undefined} />
                </div>
              </div>

              {/* 下半：客户标签 + 客户备注 整体模块（与信息栏同级，自然流位于下方） */}
              <div
                style={{
                  background: token.colorBgContainer,
                  borderRadius: 16,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  padding: '18px 18px 20px',
                }}
              >
                <SectionTitle>客户标签</SectionTitle>
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
                  color={avatarBg}
                  placeholder="添加标签"
                />

                <div style={{ borderTop: `1px dashed ${token.colorBorderSecondary}`, margin: '18px 0 16px' }} />
                <SectionTitle>客户备注</SectionTitle>
                <div style={{ fontSize: 14, lineHeight: 1.7, color: token.colorText, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {customer.notes?.trim() ? customer.notes : <span style={{ color: token.colorTextTertiary }}>暂无备注</span>}
                </div>
              </div>
            </div>

            {/* ==================== 右侧：内容区 ==================== */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              {/* 右上操作栏：tab 框 + 负责人 + 图标 */}
              <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                {/* 左：tab 框（商机/订单/活动记录切换） */}
                <SegmentedTabBar
                  value={activeTab}
                  onChange={(v) => { setActiveTab(v as typeof activeTab); setCurrentPage(1); }}
                  options={tabOptions}
                  activeColor={ct.primary}
                  showCount={false}
                />

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
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                        onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                        <SwapOutlined style={{ color: ct.primary }} />
                      </button>
                    )}
                    {onRelease && (
                      <button type="button" onClick={() => onRelease(customer)} title="释放"
                        style={circleBtnStyle(ct.primaryLight)}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
                        onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                        <RollbackOutlined style={{ color: ct.primary }} />
                      </button>
                    )}
                    <button type="button" onClick={onClose} title="关闭"
                      style={circleBtnStyle(token.colorFillQuaternary)}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = token.colorFillSecondary; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = token.colorFillQuaternary; }}
                      onFocus={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = `0 0 0 3px ${token.colorFillSecondary}`; }}
                      onBlur={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}>
                      <CloseOutlined style={{ color: token.colorTextSecondary }} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 卡片列表区域：固定高度，使各 tab 切换时弹窗高度一致，数据过多内部滚动 */}
              <div style={{ flex: 1, padding: '20px 16px 0', overflow: 'auto', height: 520 }}>
                {activeTab === 'pipeline' && customer ? (
                  <div style={{ background: token.colorFillQuaternary, borderRadius: 16, padding: '4px 4px 8px', marginBottom: 8 }}>
                    <CustomerOverview customer={customer} />
                  </div>
                ) : !detailLoaded ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} style={{ background: token.colorBgContainer, border: `1px solid ${token.colorBorderSecondary}`, borderRadius: 16, padding: '16px 20px' }}>
                        <Skeleton active paragraph={{ rows: 1 }} title={false} />
                      </div>
                    ))}
                  </div>
                ) : paginatedData.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {activeTab === 'orders' && (
                      <div
                        onClick={() => onAddPipeline?.(customer)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                          padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                          background: ct.primaryBg,
                          border: `1px dashed ${ct.primary}`,
                          transition: 'all .2s',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderStyle = 'solid';
                          e.currentTarget.style.boxShadow = `0 2px 12px ${ct.primary}25`;
                          e.currentTarget.style.background = ct.primaryLight;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderStyle = 'dashed';
                          e.currentTarget.style.boxShadow = 'none';
                          e.currentTarget.style.background = ct.primaryBg;
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                            background: ct.primary, color: '#fff', fontSize: 14,
                          }}
                        >
                          <PlusOutlined />
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: token.colorText, whiteSpace: 'nowrap' }}>
                          新建销售记录
                        </span>
                      </div>
                    )}
                    {activeTab === 'orders' && paginatedData.map((it: UnifiedRecord, index: number) => (
                      <React.Fragment key={`orders-${it.data.id}-${index}`}>
                        {it.kind === 'order' ? renderOrderItem(it.data) : renderPipelineItem(it.data)}
                      </React.Fragment>
                    ))}
                    {activeTab === 'activities' && paginatedData.map((it, index) => <React.Fragment key={`activities-${it.id ?? 'x'}-${index}`}>{renderActivityItem(it as CustomerActivity)}</React.Fragment>)}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={
                    <div style={{ color: token.colorTextSecondary, fontSize: 13 }}>
                      {activeTab === 'orders' && '暂无销售记录'}
                      {activeTab === 'activities' && '暂无活动记录'}
                    </div>
                  } style={{ padding: '52px 0' }}>
                    {activeTab === 'orders' && onCreateOrder && (
                      <button
                        type="button"
                        onClick={() => onCreateOrder(customer)}
                        style={{
                          marginTop: 8, padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
                          border: `1px solid ${ct.primary}`, color: ct.primary, background: 'transparent',
                          fontSize: 13, fontWeight: 600, transition: 'all 0.18s ease', outline: 'none',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = ct.primaryBg; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        onFocus={(e) => { e.currentTarget.style.boxShadow = `0 0 0 3px ${ct.primary}25`; }}
                        onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        新建订单
                      </button>
                    )}
                  </Empty>
                )}
              </div>

              {/* 底部：分页器 + 客户编码（概览 tab 不显示；单页能放下时不显示分页） */}
              {activeTab !== 'pipeline' && totalCount > pageSize && (
              <div style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: token.colorBgContainer }}>
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
                  <span style={{ fontSize: 12, color: token.colorTextTertiary, whiteSpace: 'nowrap' }}>{customerCode}</span>
                </div>
              </div>
              )}
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
