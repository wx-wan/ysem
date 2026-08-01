import { useMemo, memo, useState, useEffect, useCallback } from 'react';
import { Card, Popconfirm, Avatar, Row, Col } from 'antd';
import { EditOutlined, MailOutlined, PhoneOutlined, UserOutlined, SwapOutlined, RollbackOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';
import CustomerCardSparkle from './CustomerCardSparkle';
import type { Customer } from '../../api/customers';
import { getGrade } from './utils';
import TagSelector from '../TagSelector';
import { customerApi } from '../../api/customers';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { findCountry } from '../../data/countries';
import { message } from 'antd';

interface CustomerCardProps {
  customer: Customer;
  token: any;
  /** 点击卡片打开详情（列表视图传入，使整卡可点击；不传则不可点击） */
  onOpenDetail?: (customer: Customer) => void;
  /** 列表就地更新回调（可选，用于同步标签/重点星编辑） */
  onListUpdate?: (updater: (prev: Customer[]) => Customer[]) => void;
  /** 编辑客户回调（传入后头部右下角显示编辑图标） */
  onEdit?: () => void;
  /** 是否可操作（控制转交/释放/删除图标显示） */
  canOperate?: boolean;
  /** 转交客户回调（仅 canOperate 时显示图标） */
  onTransfer?: () => void;
  /** 释放到公海回调（仅 canOperate 时显示图标，带确认） */
  onRelease?: () => void;
  /** 删除客户回调（仅 canOperate 时显示图标，带确认） */
  onDelete?: () => void;
}

const CustomerCard = memo(function CustomerCard({
  customer,
  token,
  onOpenDetail,
  onListUpdate,
  onEdit,
  canOperate,
  onTransfer,
  onRelease,
  onDelete,
}: CustomerCardProps) {
  const isPublic = !customer.ownerId;

  // 头部操作图标按钮统一样式（半透明圆形）
  const actionIconStyle: React.CSSProperties = {
    width: 28,
    height: 28,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    backgroundColor: 'rgba(255,255,255,0.22)',
    backdropFilter: 'blur(4px)',
    color: token.colorWhite,
    fontSize: 14,
    lineHeight: 1,
    transition: 'background-color 0.2s',
    padding: 0,
  };

  const grade = useMemo(() => getGrade(customer), [customer]);
  const { format: formatCurrency } = useCurrencyStore();

  // 兼容：详情接口可能不返回 pipelineAmount/totalAmount，从关联数组汇总 fallback
  const displayPipelineAmount = customer.pipelineAmount
    ?? (customer.pipelines || []).reduce((sum, p) => sum + (p.amount || p.estimatedAmount || 0), 0);
  const displayTotalAmount = customer.totalAmount
    ?? (customer.orders || []).reduce((sum, o) => sum + (o.amountCNY || 0), 0);

  // 本地标签状态（可编辑，直接调接口更新）
  const [localTags, setLocalTags] = useState(customer.tags || '');

  // 是否有商机记录
  const hasPipelines = (customer.pipelines || []).length > 0;

  // 客户切换时同步本地标签
  useEffect(() => { setLocalTags(customer.tags || ''); }, [customer.id, customer.tags]);

  const handleTagsChange = useCallback((next: string) => {
    setLocalTags(next);
    customerApi
      .updateTags(customer.id, next)
      .then(() => {
        onListUpdate && onListUpdate((prev) =>
          prev.map((c) => (c.id === customer.id ? { ...c, tags: next } : c))
        );
      })
      .catch(() => {
        message.error('标签更新失败');
        setLocalTags(customer.tags || '');
      });
  }, [customer.id, customer.tags, onListUpdate]);

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
  const { customerTier, tierHeaderBg } = useMemo(() => {
    const currentYear = new Date().getFullYear().toString();
    // 已成交客户
    if (customer.firstOrderDate) {
      if (customer.firstOrderDate.startsWith(currentYear)) {
        return {
          customerTier: 'shine',
          tierHeaderBg: `linear-gradient(135deg, #ffd666 0%, ${token.colorWarning} 100%)`,
        };
      }
      return {
        customerTier: 'chest',
        tierHeaderBg: `linear-gradient(135deg, ${token.purple} 0%, ${token.purple} 100%)`,
      };
    }
    // 未成交客户：无商机记录 → 灰色 void
    if (!hasPipelines) {
      return {
        customerTier: 'void',
        tierHeaderBg: 'linear-gradient(135deg, #8a8f9a 0%, #6b7280 100%)',
      };
    }
    // 未成交客户：有商机记录，按采购意向分级
    switch (grade.grade) {
      case 'A':
        return {
          customerTier: 'cheer',
          tierHeaderBg: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
        };
      case 'B':
        return {
          customerTier: 'bottle',
          tierHeaderBg: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)',
        };
      case 'C':
        return {
          customerTier: 'hatch',
          tierHeaderBg: 'linear-gradient(135deg, #93c5fd 0%, #60a5fa 100%)',
        };
      case 'D':
      default:
        return {
          customerTier: 'dull',
          tierHeaderBg: 'linear-gradient(135deg, #bfdbfe 0%, #93c5fd 100%)',
        };
    }
  }, [customer.firstOrderDate, hasPipelines, grade.grade, token.colorWarning, token.purple]);

  // 头像背景色与卡片头部色调保持一致
  const avatarBg = useMemo(() => {
    switch (customerTier) {
      case 'shine': return '#ffd666';
      case 'chest': return token.purple;
      case 'void': return '#8a8f9a';
      case 'cheer': return '#f97316';
      case 'bottle': return '#1677ff';
      case 'hatch': return '#93c5fd';
      case 'dull': return '#bfdbfe';
      default: return token.colorPrimary;
    }
  }, [customerTier, token.purple]);

  // --- 海浪随机参数生成（基于客户ID做种子，保证每次渲染一致） ---
  const waveParams = useMemo(() => {
    const mulberry32 = (seed: number): (() => number) => {
      return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    };
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
        durationMult: 0.82 + rng() * 0.36,
        delayS: Math.round(rng() * 45) / 100,
        topOffset: Math.round(rng() * 4 - 2),
      });
    }
    return layers;
  }, [customer.id]);

  // 整卡点击：仅列表视图（传入 onOpenDetail）时启用
  const cardClickable = !!onOpenDetail;

  return (
    <div
      className={`customer-tier-${customerTier}`}
      style={{ height: '100%', position: 'relative' }}
    >
      <Card
        hoverable={cardClickable}
        onClick={cardClickable ? () => onOpenDetail!(customer) : undefined}
        style={{
          borderRadius: token.borderRadiusLG,
          boxShadow: token.boxShadowSecondary,
          cursor: cardClickable ? 'pointer' : 'default',
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
                  onListUpdate && onListUpdate((prev) =>
                    prev.map((c) =>
                      c.id === customer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                    )
                  );
                }}
              />
              <FlagIcon country={customer.country} style={{ borderRadius: 2 }} />
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: token.colorWhite, marginTop: 12, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
            {customer.companyName || '-'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)', marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
            {(() => {
              const c = findCountry(customer.country);
              const zh = c?.zh || (customer.country || '未知');
              const en = c?.code || '';
              return <>{zh}{en ? ` · ${en}` : ''}</>;
            })()}
          </div>
          {/* 联系人平铺在国家下方，按 gap 横排姓名/邮箱/电话 */}
          <div style={{ marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.88)', lineHeight: 1.4 }}>
              <UserOutlined style={{ fontSize: 11, flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.contactName || '-'}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
              <MailOutlined style={{ fontSize: 11, flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.email || '-'}</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
              <PhoneOutlined style={{ fontSize: 11, flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.phone || '-'}</span>
            </span>
          </div>

          {/* 操作图标组：头部右下角（编辑 / 转交 / 释放 / 删除） */}
          {(onEdit || canOperate) && (
            <div
              style={{
                position: 'absolute',
                right: 12,
                bottom: 12,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {onEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  title="编辑客户"
                  style={actionIconStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.38)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)'; }}
                >
                  <EditOutlined />
                </button>
              )}
              {canOperate && onTransfer && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onTransfer(); }}
                  title="转交"
                  style={actionIconStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.38)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)'; }}
                >
                  <SwapOutlined />
                </button>
              )}
              {canOperate && onRelease && (
                <Popconfirm title="确认释放到公海？" onConfirm={() => { onRelease(); }} onPopupClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); }}
                    title="释放"
                    style={actionIconStyle}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.38)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)'; }}
                  >
                    <RollbackOutlined />
                  </button>
                </Popconfirm>
              )}
              {canOperate && onDelete && (
                <Popconfirm title="确认删除？" onConfirm={() => { onDelete(); }} onPopupClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); }}
                    title="删除"
                    style={{ ...actionIconStyle, color: '#fff1f0' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,120,117,0.45)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.22)'; }}
                  >
                    <DeleteOutlined />
                  </button>
                </Popconfirm>
              )}
            </div>
          )}

          {/* 金色星光闪烁（仅新客卡片，限制在头部区域内） */}
          {customerTier === 'shine' && <CustomerCardSparkle />}
        </div>

        {/* 内容区：头像+负责人为一个整体（左右布局），与两个金额块三等分 */}
        <div style={{ padding: '16px 20px' }}>
          <Row gutter={[16, 16]} align="top">
            {/* 头像 + 负责人（整体左右布局，占一等分） */}
            <Col span={8}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 68 }}>
                <Avatar
                  size={36}
                  style={{
                    backgroundColor: avatarBg,
                    fontSize: 14,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {isPublic ? '公' : ((customer.owner?.realName || customer.owner?.username || '?').charAt(0))}
                </Avatar>
                <div style={{ minWidth: 0, textAlign: 'left' }}>
                  <div style={{ minHeight: 20, lineHeight: '20px', fontSize: 11, color: token.colorTextSecondary }}>负责人</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '32px' }}>
                    {isPublic ? '公海' : (customer.owner?.realName || customer.owner?.username || '-')}
                  </div>
                  <div style={{ fontSize: 11, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>
                    {isPublic ? '未分配' : (customer.owner?.username || '')}
                  </div>
                </div>
              </div>
            </Col>

            {/* 预计商机金额（占一等分） */}
            <Col span={8}>
              <div style={{ minHeight: 68, textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, minHeight: 20, lineHeight: '20px' }}>预计商机金额</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '32px' }}>
                  {formatCurrency(displayPipelineAmount || 0)}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>{customer._count?.pipelines ?? (customer.pipelines || []).length} 商机</div>
              </div>
            </Col>

            {/* 成交订单金额（占一等分） */}
            <Col span={8}>
              <div style={{ minHeight: 68, textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, minHeight: 20, lineHeight: '20px' }}>成交订单金额</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '32px' }}>
                  {formatCurrency(displayTotalAmount || 0)}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>{customer._count?.orders ?? (customer.orders || []).length} 单</div>
              </div>
            </Col>
          </Row>
        </div>

        {/* 底部分隔线 + 标签（左）与创建时间（右）左右分布 */}
        <div style={{ borderTop: `1px dashed ${token.colorBorderSecondary}`, padding: '14px 20px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div
            onClick={(e) => { if (cardClickable) e.stopPropagation(); }}
            style={{ flex: '1 1 auto', minWidth: 0 }}
          >
            <TagSelector value={localTags} onChange={handleTagsChange} placeholder="添加标签" color={avatarBg} />
          </div>
          <div style={{ fontSize: 11, color: token.colorTextQuaternary, whiteSpace: 'nowrap', flex: '0 0 auto' }}>
            {dayjs(customer.createdAt).format('YYYY-MM-DD')}
          </div>
        </div>
      </Card>
      {customerTier === 'chest' && <div className="chest-shimmer" />}
      {customerTier === 'cheer' && <div className="cheer-pulse" />}
      {customerTier === 'bottle' && <div className="bottle-drift" />}
      {customerTier === 'hatch' && <div className="hatch-breathe" />}
      {customerTier === 'dull' && <div className="dull-glimmer" />}
    </div>
  );
});

export default CustomerCard;
