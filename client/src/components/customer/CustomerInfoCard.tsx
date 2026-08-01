import { useMemo } from 'react';
import { Row, Col, Typography } from 'antd';
import { GlobalOutlined, UserOutlined, EditOutlined, AimOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';
import type { Customer } from '../../api/customers';
import { getGrade } from './utils';
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
    const intentMap: Record<string, string> = { A: '准成交', B: '高意向', C: '中意向', D: '低意向' };
    switch (grade.grade) {
      case 'A': return {
        tier: 'cheer' as const,
        tierHeaderBg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        tierAvatarBg: '#f97316',
        tierTypeBadge: `未成交客户 · ${intentMap.A}`,
      };
      case 'B': return {
        tier: 'bottle' as const,
        tierHeaderBg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
        tierAvatarBg: '#3b82f6',
        tierTypeBadge: `未成交客户 · ${intentMap.B}`,
      };
      case 'C': return {
        tier: 'hatch' as const,
        tierHeaderBg: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
        tierAvatarBg: '#93c5fd',
        tierTypeBadge: `未成交客户 · ${intentMap.C}`,
      };
      case 'D':
      default: return {
        tier: 'dull' as const,
        tierHeaderBg: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)',
        tierAvatarBg: '#bfdbfe',
        tierTypeBadge: `未成交客户 · ${intentMap.D}`,
      };
    }
  }, [customer, token.colorWarning, token.purple]);
}

/* ========== 海浪随机参数（基于客户ID确定性伪随机） ========== */
function useWaveParams(customerId: string) {
  return useMemo(() => {
    const mulberry32 = (seed: number): (() => number) => {
      return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    };
    const baseSeed = String(customerId || '0').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const layers: { durationMult: number; delayS: number; topOffset: number }[] = [];
    for (let i = 0; i < 2; i++) {
      const rng = mulberry32(baseSeed + i * 7919);
      layers.push({
        durationMult: 0.82 + rng() * 0.36,
        delayS: Math.round(rng() * 45) / 100,
        topOffset: Math.round(rng() * 4 - 2),
      });
    }
    return layers;
  }, [customerId]);
}

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
  const waveParams = useWaveParams(customer.id || '');

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
        {/* 装饰圆形 */}
        <div style={{ position: 'absolute', top: -36, right: -24, width: 120, height: 120, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -48, right: 60, width: 88, height: 88, borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.04)' }} />

        {/* 金币掉落（仅新客） */}
        {tier === 'shine' && (
          <div className="coin-rain-container">
            {[4, 8, 14, 20, 28, 36, 44, 56].map((delay, i) => (
              <div
                key={i}
                className="coin-particle"
                style={{
                  left: `${10 + (i * 11) % 75}%`,
                  animationDuration: `${2 + (i % 3) * 0.6}s`,
                  animationDelay: `${delay * 0.15}s`,
                  width: `${8 + (i % 4) * 2}px`,
                  height: `${8 + (i % 4) * 2}px`,
                }}
              />
            ))}
          </div>
        )}

        {/* 海浪线条动画（高意向 & 中意向 & 低意向） */}
        {(tier === 'bottle' || tier === 'hatch' || tier === 'dull') && (
          <div className="wave-line-container">
            <svg className="wave-svg wave-bob1" viewBox="0 0 800 120" preserveAspectRatio="none"
              style={{
                top: 48 + waveParams[0].topOffset,
                animationDuration: `${(10.4 * waveParams[0].durationMult).toFixed(2)}s`,
                animationDelay: `${waveParams[0].delayS}s`,
              }}>
              <path d="M0,28 C22,22 68,22 90,28 C112,34 158,34 180,28 C202,22 248,22 270,28 C292,34 338,34 360,28 C382,22 428,22 450,28 C472,34 518,34 540,28 C562,22 608,22 630,28 C652,34 698,34 720,28 C742,22 788,22 800,26 L800,120 L0,120 Z" fill="rgba(255,255,255,0.08)" />
            </svg>
            <svg className="wave-svg wave-bob2" viewBox="0 0 800 120" preserveAspectRatio="none"
              style={{
                top: 68 + waveParams[1].topOffset,
                animationDuration: `${(13.6 * waveParams[1].durationMult).toFixed(2)}s`,
                animationDelay: `${waveParams[1].delayS}s`,
              }}>
              <path d="M0,42 C30,24 100,24 130,42 C160,50 230,50 260,42 C290,24 360,24 390,42 C420,50 490,50 520,42 C550,24 620,24 650,42 C680,50 750,50 780,42 C800,40 800,40 800,42 L800,120 L0,120 Z" fill="rgba(255,255,255,0.07)" />
            </svg>
          </div>
        )}

        {/* 顶行：类型标签 + 操作图标 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
          <span style={{
            backgroundColor: 'rgba(255,255,255,0.2)',
            backdropFilter: 'blur(4px)',
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
            <FlagIcon country={customer.country} style={{ borderRadius: 2 }} />
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
              backdropFilter: 'blur(6px)',
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

      {/* 外层特效 */}
      {tier === 'shine' && <div className="sparkle-container"><div className="sparkle-particle" /></div>}
      {tier === 'chest' && <div className="chest-shimmer" />}
      {tier === 'cheer' && <div className="cheer-pulse" />}
      {tier === 'bottle' && <div className="bottle-drift" />}
      {tier === 'hatch' && <div className="hatch-breathe" />}
      {tier === 'dull' && <div className="dull-glimmer" />}

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
