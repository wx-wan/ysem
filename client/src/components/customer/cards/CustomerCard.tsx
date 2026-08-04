import { useMemo, memo, useState, useEffect, useCallback } from 'react';
import { Card, Popconfirm, Avatar, Row, Col } from 'antd';
import { EditOutlined, MailOutlined, PhoneOutlined, UserOutlined, SwapOutlined, RollbackOutlined, DeleteOutlined, MoneyCollectOutlined } from '@ant-design/icons';
import KeyAccountStar from '../../KeyAccountStar';
import type { Customer } from '../../../api/customers';
import { getGrade, getCustomerLogicLabel } from '../shared/utils';
import PurchaseIntentTag from '../shared/PurchaseIntentTag';
import { getCustomerTier, getAvatarColor } from '../shared/customerTier';
import { useDs } from '../shared/ds';
import TagSelector from '../../TagSelector';
import CountrySelect from '../../CountrySelect';
import { customerApi } from '../../../api/customers';
import Price from '../../common/Price';
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
  const ds = useDs();
  const token2 = token; // 兼容既有 token 引用

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
    color: token2.colorWhite,
    fontSize: 14,
    lineHeight: 1,
    transition: 'background-color 0.2s',
    padding: 0,
  };

  const grade = useMemo(() => getGrade(customer), [customer]);
  const intentLabel = useMemo(() => getCustomerLogicLabel(customer), [customer]);

  // 兼容：详情接口可能不返回 pipelineAmount/totalAmount，从关联数组汇总 fallback
  const displayPipelineAmount = customer.pipelineAmount
    ?? (customer.pipelines || []).reduce((sum, p) => sum + (p.amount || p.estimatedAmount || 0), 0);
  const displayTotalAmount = customer.totalAmount
    ?? (customer.orders || []).reduce((sum, o) => sum + (o.amountCNY || 0), 0);

  // 本地标签状态（可编辑，直接调接口更新）
  const [localTags, setLocalTags] = useState(customer.tags || '');

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

  // 荣誉层级：复用与 CustomerDetailModal 一致的共享主题（含渐变背景与层次色）
  const { tier: customerTier, headerGradient: tierHeaderBg } = useMemo(
    () => getCustomerTier(customer),
    [customer]
  );

  // 头像背景色与卡片头部色调保持一致
  const avatarBg = useMemo(() => getAvatarColor(customerTier, token), [customerTier, token]);

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PurchaseIntentTag label={intentLabel} size="small" style={{
                backgroundColor: 'rgba(255,255,255,0.2)',
                color: token.colorWhite,
              }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <KeyAccountStar
                isKeyAccount={customer.isKeyAccount || false}
                color="rgba(255,255,255,0.9)"
                mutedColor="rgba(255,255,255,0.35)"
                onToggle={() => {
                  const nextKey = !customer.isKeyAccount;
                  // 本地乐观更新
                  onListUpdate && onListUpdate((prev) =>
                    prev.map((c) =>
                      c.id === customer.id ? { ...c, isKeyAccount: nextKey } : c
                    )
                  );
                  // 同步后端持久化
                  customerApi.update(customer.id, { isKeyAccount: nextKey } as any).catch(() => {
                    // 失败回滚：恢复原值
                    onListUpdate && onListUpdate((prev) =>
                      prev.map((c) =>
                        c.id === customer.id ? { ...c, isKeyAccount: !nextKey } : c
                      )
                    );
                    message.error('重点客户状态更新失败');
                  });
                }}
              />
            </div>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: token.colorWhite, marginTop: 12, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
            {customer.companyName || '-'}
          </div>
          {/* 国家 + 联系人名称 同一行 */}
          <div style={{ marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 14px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>
              <CountrySelect readOnly value={customer.country} style={{ color: 'inherit', fontSize: 11 }} />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.88)', lineHeight: 1.4 }}>
              <UserOutlined style={{ fontSize: 11, flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.contactName || '-'}</span>
            </span>
          </div>
          {/* 下方：联系方式（电话） */}
          <div style={{ marginTop: 4, position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 16px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
              <PhoneOutlined style={{ fontSize: 11, flexShrink: 0 }} />
              <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.phone || '-'}</span>
            </span>
            {customer.email && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
                <MailOutlined style={{ fontSize: 11, flexShrink: 0 }} />
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.email}</span>
              </span>
            )}
          </div>
          {/* 首次合作日期 */}
          {customer.firstOrderDate && (
            <div style={{ marginTop: 4, position: 'relative', zIndex: 1 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4 }}>
                <MoneyCollectOutlined style={{ fontSize: 11, flexShrink: 0 }} />
                <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{customer.firstOrderDate}</span>
              </span>
            </div>
          )}

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
                  <Price value={displayPipelineAmount || 0} />
                </div>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>{customer._count?.pipelines ?? (customer.pipelines || []).length} 商机</div>
              </div>
            </Col>

            {/* 成交订单金额（占一等分） */}
            <Col span={8}>
              <div style={{ minHeight: 68, textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: token.colorTextSecondary, minHeight: 20, lineHeight: '20px' }}>成交订单金额</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '32px' }}>
                  <Price value={displayTotalAmount || 0} />
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
            {customer.customerCode || '-'}
          </div>
        </div>
      </Card>
    </div>
  );
});

export default CustomerCard;
