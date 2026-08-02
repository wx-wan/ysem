import React, { useState, useMemo } from 'react';
import { Modal, Badge, Avatar, Empty, Typography, Tag, Pagination, ConfigProvider, theme } from 'antd';
import {
  UserOutlined,
  PhoneOutlined,
  MailOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  ClockCircleOutlined,
  EditOutlined,
  SwapOutlined,
  RollbackOutlined,
  DeleteOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { Customer } from '../../api/customers';
import { getGrade } from './utils';
import { getCustomerTier } from './customerTier';
import { findCountry } from '../../data/countries';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';

const { Text } = Typography;

interface CustomerDetailModalProps {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
  onEdit?: (customer: Customer) => void;
  onTransfer?: (customer: Customer) => void;
  onRelease?: (customer: Customer) => void;
  onDelete?: (customer: Customer) => void;
  onAddPipeline?: (customer: Customer) => void;
  onCreateOrder?: (customer: Customer) => void;
  /** 切换重点客户成功后由父级刷新数据 */
  onToggleKeyAccount?: (customer: Customer) => void;
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
  open, customer, onClose, onEdit, onTransfer, onRelease, onDelete, onAddPipeline, onCreateOrder, onToggleKeyAccount,
}) => {
  const { token } = theme.useToken();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'orders' | 'activities'>('pipeline');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 3;

  const ct = getCustomerTier(customer);
  const isPublic = !customer?.ownerId;

  // 左侧头部文字色：浅色渐变用深色文字，深色渐变用白色
  const headerText = ct.headerTextDark ? token.colorTextHeading : token.colorWhite;
  const headerTextSub = ct.headerTextDark ? token.colorTextSecondary : 'rgba(255,255,255,0.85)';
  const headerTextFaint = ct.headerTextDark ? token.colorTextTertiary : 'rgba(255,255,255,0.7)';

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
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={980}
      centered
      closable={false}
      styles={{ root: { borderRadius: 20 }, body: { padding: 0, overflow: 'hidden', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 } }}
    >
      {customer && (
        <div style={{ display: 'flex', minHeight: 520, background: token.colorBgContainer }}>
          {/* ==================== 左侧：彩色信息卡片 ==================== */}
          <div
            style={{
              width: 280, minWidth: 280,
              background: ct.headerGradient, padding: 28,
              display: 'flex', flexDirection: 'column',
              position: 'relative', overflow: 'hidden',
              borderRadius: '20px 0 0 20px',
            }}
          >
            {/* 装饰性背景圆 */}
            <div style={{ position: 'absolute', top: -50, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
            <div style={{ position: 'absolute', bottom: -40, left: -40, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

            {/* 类型标签 */}
            <div style={{ position: 'relative', zIndex: 1 }}>
              <span style={{
                display: 'inline-block', background: 'rgba(255,255,255,0.22)', backdropFilter: 'blur(8px)',
                color: token.colorWhite, fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, letterSpacing: 0.3,
              }}>
                {typeLabel}
              </span>
            </div>

            {/* 星标 + 公司名 */}
            <div style={{ marginTop: 16, position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: headerText, lineHeight: 1.3, wordBreak: 'break-word' }}>
                {customer.companyName || '-'}
              </h2>
              <KeyAccountStar isKeyAccount={customer.isKeyAccount || false} customerId={customer.id} color={ct.headerTextDark ? '#7c3aed' : 'rgba(255,255,255,0.95)'} mutedColor={ct.headerTextDark ? 'rgba(124,58,237,0.3)' : 'rgba(255,255,255,0.35)'} onToggle={() => onToggleKeyAccount?.(customer)} />
            </div>

            {/* 国家 + 联系人 + 电话 */}
            <div style={{ marginTop: 18, position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FlagIcon country={customer.country} style={{ borderRadius: 3 }} />
                <span style={{ fontSize: 13, color: headerTextSub, fontWeight: 500 }}>
                  {(() => { const c = findCountry(customer.country); const zh = c?.zh || (customer.country || '未知'); const en = c?.code || ''; return <>{zh}{en ? ` · ${en}` : ''}</>; })()}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: headerTextSub }}>
                <UserOutlined style={{ fontSize: 13 }} /><span style={{ fontSize: 13 }}>{customer.contactName || '-'}</span>
              </div>
              {customer.email && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: headerTextFaint }}>
                  <MailOutlined style={{ fontSize: 13 }} /><span style={{ fontSize: 13 }}>{customer.email}</span>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: headerTextFaint }}>
                <PhoneOutlined style={{ fontSize: 13 }} /><span style={{ fontSize: 13 }}>{customer.phone || '-'}</span>
              </div>
            </div>

            {/* 操作按钮组 */}
            <div style={{ marginTop: 'auto', paddingTop: 20, position: 'relative', zIndex: 1, display: 'flex', gap: 10 }}>
              {onEdit && (
                <button type="button" onClick={() => onEdit(customer)} title="编辑"
                  style={circleBtnStyle('rgba(255,255,255,0.22)')}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.38)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)'; }}>
                  <EditOutlined />
                </button>
              )}
              {onDelete && (
                <button type="button" onClick={() => onDelete(customer)} title="删除"
                  style={circleBtnStyle('rgba(255,120,117,0.35)')}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,120,117,0.55)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,120,117,0.35)'; }}>
                  <DeleteOutlined />
                </button>
              )}
            </div>

            {/* 底部标签 */}
            <div style={{ marginTop: 16, position: 'relative', zIndex: 1, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(typeof customer.tags === 'string' ? customer.tags.split(',').filter(Boolean) : []).slice(0, 3).map((tag: string) => (
                <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: ct.headerTextDark ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.18)', color: headerText, fontSize: 11, fontWeight: 500, padding: '3px 10px', borderRadius: 14 }}>
                  {tag}<span style={{ cursor: 'pointer', opacity: 0.7, fontSize: 10 }} title="移除">×</span>
                </span>
              ))}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: `1px dashed ${ct.headerTextDark ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.35)'}`, color: headerTextFaint, fontSize: 11, padding: '3px 10px', borderRadius: 14, cursor: 'pointer' }}>
                ＋添加标签
              </span>
            </div>
          </div>

          {/* ==================== 右侧：内容区 ==================== */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* 右上操作栏：tab + 图标 + 负责人 */}
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
              {/* 左：胶囊 tab 切换器 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: token.colorFillQuaternary, borderRadius: 22, padding: '3px 5px', width: 'fit-content' }}>
                {tabOptions.map((opt) => {
                  const active = activeTab === opt.key;
                  return (
                    <button key={opt.key} onClick={() => { setActiveTab(opt.key); setCurrentPage(1); }} style={{
                      border: 'none', outline: 'none', cursor: 'pointer', padding: '6px 16px', borderRadius: 18,
                      fontSize: 13, fontWeight: active ? 600 : 500, whiteSpace: 'nowrap', transition: 'all 0.22s ease',
                      background: active ? ct.primary : 'transparent', color: active ? '#fff' : token.colorTextTertiary,
                      display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                      {opt.key === 'pipeline' && <DollarOutlined />}
                      {opt.key === 'orders' && <ShoppingCartOutlined />}
                      {opt.key === 'activities' && <ClockCircleOutlined />}
                      {opt.label}
                      {opt.count > 0 && (
                        <Badge count={opt.count} style={{ fontSize: 10, lineHeight: 17, height: 17, minWidth: 17, padding: '0 5px', boxShadow: 'none', background: active ? 'rgba(255,255,255,0.92)' : token.colorFillSecondary, color: active ? ct.primary : token.colorTextSecondary }} />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 右：操作图标 + 负责人 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
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
                {/* 负责人信息 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, borderLeft: `1px solid ${token.colorBorder}` }}>
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
              <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{dayjs().format('YYYY-MM-DD')}</Text>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default CustomerDetailModal;
