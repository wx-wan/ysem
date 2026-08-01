import { useMemo, memo } from 'react';
import { Card, Avatar } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';
import CustomerCardSparkle from './CustomerCardSparkle';
import type { Customer } from '../../api/customers';
import { getGrade, tagColorToHex } from './utils';
import CustomerTags from './CustomerTags';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { findCountry } from '../../data/countries';

interface CustomerCardProps {
  customer: Customer;
  token: any;
  onOpenDetail: (customer: Customer) => void;
  onListUpdate: (updater: (prev: Customer[]) => Customer[]) => void;
}

const CustomerCard = memo(function CustomerCard({
  customer,
  token,
  onOpenDetail,
  onListUpdate,
}: CustomerCardProps) {
  const isPublic = !customer.ownerId;
  const ownerName = isPublic ? '公海' : (customer.owner?.realName || customer.owner?.username || '');
  const firstChar = isPublic
    ? '公'
    : (ownerName?.charAt(0) || customer.contactName?.charAt(0) || customer.companyName?.charAt(0) || '?');

  const grade = useMemo(() => getGrade(customer), [customer]);
  const gradeColor = useMemo(() => tagColorToHex(grade.tagColor, token), [grade.tagColor, token]);
  const { format: formatCurrency } = useCurrencyStore();

  // 是否有商机记录
  const hasPipelines = (customer.pipelines || []).length > 0;

  const typeLabel = useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    if (customer.firstOrderDate) {
      if (customer.firstOrderDate.startsWith(currentYear)) return '本年度新客';
      return '往年老客';
    }
    const intentMap: Record<string, string> = { A: '准成交', B: '高意向', C: '中意向', D: '低意向' };
    return hasPipelines ? `未成交客户 · ${intentMap[grade.grade] || '低意向'}` : '未成交客户';
  }, [customer.firstOrderDate, hasPipelines, grade.grade]);

  // 荣誉层级：根据客户类型 + 采购意向决定卡片视觉主题
  // 荣誉层级：根据客户类型 + 采购意向决定卡片视觉主题
  const { customerTier, tierHeaderBg, avatarBg } = useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    // 已成交客户
    if (customer.firstOrderDate) {
      if (customer.firstOrderDate.startsWith(currentYear)) {
        return {
          customerTier: 'shine',
          tierHeaderBg: `linear-gradient(135deg, #ffd666 0%, ${token.colorWarning} 100%)`,
          avatarBg: '#ffd666',
        };
      }
      return {
        customerTier: 'chest',
        tierHeaderBg: `linear-gradient(135deg, ${token.purple} 0%, ${token.purple} 100%)`,
        avatarBg: token.purple,
      };
    }
    // 未成交客户：无商机记录 → 灰色 void
    if (!hasPipelines) {
      return {
        customerTier: 'void',
        tierHeaderBg: 'linear-gradient(135deg, #8a8f9a 0%, #6b7280 100%)',
        avatarBg: '#8a8f9a',
      };
    }
    // 未成交客户：有商机记录，按采购意向分级
    switch (grade.grade) {
      case 'A':
        return {
          customerTier: 'cheer',
          tierHeaderBg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
          avatarBg: '#f97316',
        };
      case 'B':
        return {
          customerTier: 'bottle',
          tierHeaderBg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          avatarBg: '#3b82f6',
        };
      case 'C':
        return {
          customerTier: 'hatch',
          tierHeaderBg: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
          avatarBg: '#93c5fd',
        };
      case 'D':
      default:
        return {
          customerTier: 'dull',
          tierHeaderBg: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)',
          avatarBg: '#bfdbfe',
        };
    }
  }, [customer.firstOrderDate, hasPipelines, grade.grade, token.colorWarning, token.purple]);

  // --- 海浪随机参数生成（基于客户ID做种子，保证每次渲染一致） ---
  const waveParams = useMemo(() => {
    // Mulberry32 PRNG — 确定性伪随机
    const mulberry32 = (seed: number): (() => number) => {
      return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    };
    // 用 customer.id 的字符编码求和作为基础种子
    const baseSeed = String(customer.id || '0').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    interface WaveParam {
      durationMult: number;
      delayS: number;
      topOffset: number;
    }
    const layers: WaveParam[] = [];
    for (let i = 0; i < 2; i++) {
      const rng = mulberry32(baseSeed + i * 7919);
      layers.push({
        durationMult: 0.82 + rng() * 0.36,   // 0.82 ~ 1.18
        delayS: Math.round(rng() * 45) / 100, // 0.00 ~ 0.45s
        topOffset: Math.round(rng() * 4 - 2),  // -2 ~ +2px 微调
      });
    }
    return layers;
  }, [customer.id]);

  return (
    <div
      className={`customer-tier-${customerTier}`}
      style={{ height: '100%', position: 'relative' }}
    >
      <Card
        hoverable
        onClick={() => onOpenDetail(customer)}
        style={{
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          cursor: 'pointer',
          height: '100%',
          overflow: 'hidden',
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* 彩色头部区域 */}
        <div
          className="customer-header-area"
          style={{
            background: tierHeaderBg,
            padding: '20px 20px 18px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{
            position: 'absolute', top: -36, right: -24,
            width: 120, height: 120, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.08)',
          }} />
          <div style={{
            position: 'absolute', bottom: -48, right: 60,
            width: 88, height: 88, borderRadius: '50%',
            backgroundColor: 'rgba(255,255,255,0.04)',
          }} />

          {/* 金币掉落（仅新客卡片） */}
          {customerTier === 'shine' && (
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
          {(customerTier === 'bottle' || customerTier === 'hatch' || customerTier === 'dull') && (
            <div className="wave-line-container">
              {/* 上层 — 涌浪（大尺度起伏） */}
              <svg className="wave-svg wave-bob1" viewBox="0 0 800 120" preserveAspectRatio="none"
                style={{
                  top: 48 + waveParams[0].topOffset,
                  animationDuration: `${(10.4 * waveParams[0].durationMult).toFixed(2)}s`,
                  animationDelay: `${waveParams[0].delayS}s`,
                }}>
                <path d="M0,28 C22,22 68,22 90,28 C112,34 158,34 180,28 C202,22 248,22 270,28 C292,34 338,34 360,28 C382,22 428,22 450,28 C472,34 518,34 540,28 C562,22 608,22 630,28 C652,34 698,34 720,28 C742,22 788,22 800,26 L800,120 L0,120 Z" fill="rgba(255,255,255,0.08)" />
              </svg>
              {/* 下层 — 近岸波浪，偶然向上翻涌盖过上层 */}
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

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                backgroundColor: 'rgba(255,255,255,0.2)',
                backdropFilter: 'blur(4px)',
                color: token.colorWhite,
                fontSize: 11, fontWeight: 600,
                padding: '3px 10px',
                borderRadius: token.borderRadiusSM,
                lineHeight: '18px',
                letterSpacing: '0.3px',
              }}>
                {typeLabel}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <KeyAccountStar
                isKeyAccount={customer.isKeyAccount || false}
                customerId={customer.id}
                color="rgba(255,255,255,0.9)"
                mutedColor="rgba(255,255,255,0.35)"
                onToggle={() => {
                  onListUpdate((prev) =>
                    prev.map((c) =>
                      c.id === customer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                    )
                  );
                }}
              />
              <FlagIcon country={customer.country} style={{ borderRadius: 2 }} />
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: token.colorWhite, marginTop: 14, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
            {customer.companyName || '-'}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            <GlobalOutlined style={{ fontSize: 11 }} />
            {findCountry(customer.country)?.zh || (customer.country || '未知')}
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 auto', minWidth: 0 }}>
            <Avatar size={40} style={{ backgroundColor: avatarBg, fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
              {firstChar}
            </Avatar>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {customer.contactName || '-'}
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {customer.email || '-'}
              </div>
              {customer.phone ? (
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{customer.phone}</div>
              ) : (
                <div style={{ fontSize: 12, color: token.colorTextQuaternary }}>暂无联系方式</div>
              )}
            </div>
          </div>

          <div style={{ textAlign: 'right', flex: '0 0 auto', margin: '0 12px' }}>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>预计商机金额</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
              {formatCurrency(customer.pipelineAmount || 0)}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>{customer._count?.pipelines ?? 0} 商机</div>
          </div>

          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>成交订单金额</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
              {formatCurrency(customer.totalAmount || 0)}
            </div>
            <div style={{ fontSize: 11, color: token.colorTextSecondary }}>{customer._count?.orders ?? 0} 单</div>
          </div>
        </div>

        {/* 底部分隔线 + 标签 */}
        <div style={{ borderTop: `1px dashed ${token.colorBorderSecondary}`, padding: '10px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CustomerTags tags={customer.tags} token={token} />
          <div style={{ fontSize: 11, color: token.colorTextQuaternary, whiteSpace: 'nowrap', marginLeft: 8 }}>
            {dayjs(customer.createdAt).format('YYYY-MM-DD')}
          </div>
        </div>
      </Card>
      {customerTier === 'shine' && <CustomerCardSparkle />}
      {customerTier === 'chest' && <div className="chest-shimmer" />}
      {customerTier === 'cheer' && <div className="cheer-pulse" />}
      {customerTier === 'bottle' && <div className="bottle-drift" />}
      {customerTier === 'hatch' && <div className="hatch-breathe" />}
      {customerTier === 'dull' && <div className="dull-glimmer" />}
    </div>
  );
});

export default CustomerCard;
