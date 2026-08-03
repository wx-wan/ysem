import { useMemo } from 'react';
import { Row, Col, Typography } from 'antd';
import { GlobalOutlined, UserOutlined, EditOutlined, AimOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KeyAccountStar from '../KeyAccountStar';
import type { Customer } from '../../api/customers';
import { getGrade } from './utils';
import { INTENT_LABEL } from './intentLevel';
import CustomerTags from './CustomerTags';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { findCountry } from '../../data/countries';

/* ========== InfoRow 展示组件 ========== */
export function InfoRow({ label, value }: { label: string; value?: string | React.ReactNode }) {
  return (
    <div style={{ display: 'flex', padding: '7px 0', borderBottom: '1px solid #f5f5f5' }}>
      <span style={{ width: 110, flexShrink: 0, fontSize: 13, color: '#8c8c8c' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: '#262626' }}>{value || '-'}</span>
    </div>
  );
}

/* ========== 层级信息计算（与外部卡片一致） ========== */
export function useCustomerTier(customer: Customer, token: any) {
  return useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    const hasPipelines = (customer.pipelines || []).length > 0;
    const grade = getGrade(customer);

    if (customer.firstOrderDate) {
      if (customer.firstOrderDate.startsWith(currentYear)) {
        return {
          tier: 'shine' as const,
          tierHeaderBg: `linear-gradient(135deg, #ffd666 0%, ${token.colorWarning} 100%)`,
          tierAvatarBg: '#ffd666',
          tierTypeBadge: '本年度新客',
        };
      }
      return {
        tier: 'chest' as const,
        tierHeaderBg: `linear-gradient(135deg, ${token.purple || '#722ed1'} 0%, ${token.purple || '#722ed1'} 100%)`,
        tierAvatarBg: token.purple || '#722ed1',
        tierTypeBadge: '往年老客',
      };
    }
    if (!hasPipelines) {
      return {
        tier: 'void' as const,
        tierHeaderBg: 'linear-gradient(135deg, #8a8f9a 0%, #6b7280 100%)',
        tierAvatarBg: '#8a8f9a',
        tierTypeBadge: '未成交客户',
      };
    }
    const { grade: g } = grade;
    switch (g) {
      case 'A': return {
        tier: 'cheer' as const,
        tierHeaderBg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        tierAvatarBg: '#f97316',
        tierTypeBadge: `未成交客户 · ${INTENT_LABEL.A}`,
      };
      case 'B': return {
        tier: 'bottle' as const,
        tierHeaderBg: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
        tierAvatarBg: '#1677ff',
        tierTypeBadge: `未成交客户 · ${INTENT_LABEL.B}`,
      };
      case 'C': return {
        tier: 'hatch' as const,
        tierHeaderBg: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
        tierAvatarBg: '#3b82f6',
        tierTypeBadge: `未成交客户 · ${INTENT_LABEL.C}`,
      };
      case 'D':
      default: return {
        tier: 'dull' as const,
        tierHeaderBg: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
        tierAvatarBg: '#60a5fa',
        tierTypeBadge: `未成交客户 · ${INTENT_LABEL.D}`,
      };
    }
  }, [customer, token.colorWarning, token.purple]);
}

/* ========== 详情卡片属性 ========== */
interface CustomerInfoCardProps {
  customer: Customer;
  token: any;
  /** 是否显示统计卡片行 */
  showStats?: boolean;
  /** 是否展示模式（否则为编辑模式由调用方自己渲染） */
  readonly?: boolean;
  /** 编辑按钮回调 */
  onEdit?: () => void;
  /** 头部右侧额外内容，比如操作按钮 */
  headerExtra?: React.ReactNode;
  /** 底部额外内容 */
  footerExtra?: React.ReactNode;
  /** KeyAccount 星标切换回调 */
  onKeyAccountToggle?: (isKeyAccount: boolean) => void;
}

/* ── 渐变卡片内的联系人信息行 ── */
function ContactRow({ label, value }: { label: string; value?: string | React.ReactNode }) {
  if (!value) return null;
  return (
    <div style={{ display: 'flex', padding: '3px 0' }}>
      <span style={{ width: 90, flexShrink: 0, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>{label}</span>
      <Typography.Text
        style={{ flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.85)' }}
        ellipsis={{ tooltip: typeof value === 'string' ? value : undefined }}
      >
        {value}
      </Typography.Text>
    </div>
  );
}

export default function CustomerInfoCard({
  customer,
  token,
  showStats = true,
  readonly = true,
  onEdit,
  headerExtra,
  footerExtra,
  onKeyAccountToggle,
}: CustomerInfoCardProps) {
  const { format: formatCurrency } = useCurrencyStore();
  const { tier, tierHeaderBg, tierTypeBadge } = useCustomerTier(customer, token);

  return (
    <div style={{ position: 'relative' }}>
      {/* ========== 彩色头部卡片（含公司信息） ========== */}
      <div
        style={{
          background: tierHeaderBg,
          borderRadius: token.borderRadiusLG,
          padding: '24px 28px 20px',
          marginBottom: showStats ? 20 : 0,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 顶行：类型标签 + 操作图标 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
          <span style={{
            backgroundColor: 'rgba(255,255,255,0.2)',
            color: token.colorWhite,
            fontSize: 11, fontWeight: 600,
            padding: '3px 10px',
            borderRadius: token.borderRadiusSM,
            lineHeight: '18px',
          }}>
            {tierTypeBadge}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <KeyAccountStar
              isKeyAccount={customer.isKeyAccount || false}
              customerId={customer.id}
              color="rgba(255,255,255,0.9)"
              mutedColor="rgba(255,255,255,0.35)"
              onToggle={onKeyAccountToggle ? () => onKeyAccountToggle(!customer.isKeyAccount) : undefined}
            />
          </div>
        </div>

        {/* 公司名称 */}
        <div style={{ fontSize: 22, fontWeight: 700, color: token.colorWhite, marginTop: 14, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
          {customer.companyName || '-'}
        </div>

        {/* 国家 + 来源渠道（小字行） */}
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <GlobalOutlined style={{ fontSize: 12 }} />
            {findCountry(customer.country)?.zh || (customer.country || '未知')}
          </span>
          {customer.source && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <AimOutlined style={{ fontSize: 12 }} />
              {customer.source}
            </span>
          )}
        </div>

        {/* ── 客户标签 ── */}
        <div style={{ marginTop: 12, position: 'relative', zIndex: 1 }}>
          <CustomerTags tags={customer.tags} token={token} variant="overlay" />
        </div>

        {/* ── 虚线分割 ── 联系人信息（卡片内）── */}
        {readonly && (
          <>
            <div style={{
              borderTop: '1px dashed rgba(255,255,255,0.25)',
              margin: '12px 0 10px',
              position: 'relative',
              zIndex: 1,
            }} />

            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14, color: 'rgba(255,255,255,0.85)', position: 'relative', zIndex: 1 }}>
              <UserOutlined style={{ marginRight: 6 }} />联系人信息
            </div>

            <Row gutter={[16, 4]} style={{ position: 'relative', zIndex: 1 }}>
              <Col xs={24} sm={12}>
                <ContactRow label="联系人" value={customer.contactName} />
                <ContactRow label="职位" value={(customer as any).position} />
                <ContactRow label="电话" value={customer.phone} />
                <ContactRow label="邮箱" value={customer.email} />
                <ContactRow label="微信" value={(customer as any).wechat} />
              </Col>
              <Col xs={24} sm={12}>
                <ContactRow label="WhatsApp" value={(customer as any).whatsapp} />
                <ContactRow label="Skype" value={(customer as any).skype} />
                <ContactRow label="时区" value={(customer as any).timezone} />
                <ContactRow label="语言" value={(customer as any).language} />
                <ContactRow label="偏好沟通方式" value={(customer as any).preferredContact} />
              </Col>
            </Row>
          </>
        )}

        {/* ── 右下角编辑图标 ── */}
        {readonly && onEdit && (
          <div
            onClick={onEdit}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 20,
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.18)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.3)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.18)'; }}
          >
            <EditOutlined style={{ color: token.colorWhite, fontSize: 14 }} />
          </div>
        )}

        {/* 头部额外内容 */}
        {headerExtra}
      </div>

      {/* ========== 统计卡片 ========== */}
      {showStats && (
        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={6}>
            <div style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: token.colorTextHeading }}>{formatCurrency(customer.totalAmount || 0)}</div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>累计采购金额</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: token.colorTextHeading }}>{customer._count?.orders ?? 0}</div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>订单总数</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: token.colorTextHeading }}>
                {customer.createdAt ? dayjs(customer.createdAt).format('YYYY-MM-DD') : '-'}
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>创建时间</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: '14px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: token.colorTextHeading }}>{customer.owner?.realName || customer.owner?.username || (customer.ownerId ? '-' : '公海')}</div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>负责人</div>
            </div>
          </Col>
        </Row>
      )}

      {/* 底部额外内容 */}
      {footerExtra}
    </div>
  );
}
