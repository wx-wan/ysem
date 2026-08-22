import React, { useEffect, useMemo, useState } from 'react';
import AppModal from '../../AppModal';
import { Avatar, Button, Empty, Tag, theme, Tooltip } from 'antd';
import {
  EditOutlined, CloseOutlined,
  ProfileOutlined, ArrowsAltOutlined, ColumnHeightOutlined,
  ColumnWidthOutlined, HomeOutlined, FileTextOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../../stores/useAuthStore';
import { Product, ProductActivity } from '../../../api/products';
import { SalesItem, STAGE_META } from '../../../api/sales';
import { SUPPLY_MODES } from '../../../config/product';
import ProductOverview from './ProductOverview';
import Price from '../../common/Price';
import SegmentedTabBar from '../../common/SegmentedTabBar';
import ProductImagesStack from '../../common/ProductImagesStack';
import dayjs from 'dayjs';
import './ProductDetailModal.css';

type TabKey = 'overview' | 'sales' | 'activity';

interface ProductDetailModalProps {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onDelete: () => void;
  onCreateQuote?: (product: Product) => void;
  onApplySample?: (product: Product) => void;
  canDelete?: boolean;
  salesList: SalesItem[];
  salesLoading: boolean;
  activities: ProductActivity[];
  userMap?: Record<string, { id: string; username: string; realName?: string }>;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product, open, onClose, onEdit, onCreateQuote, onApplySample,
  salesList, salesLoading, activities, userMap,
}) => {
  const { token } = theme.useToken();
  const { user } = useAuthStore();
  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    if (open) setTab('overview');
  }, [open, product?.id]);

  const supplyLabels = useMemo(() => {
    if (!product?.supplyModes) return [];
    const arr = String(product.supplyModes)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return arr
      .map((m) => SUPPLY_MODES.find((o) => o.value === m)?.label)
      .filter((l): l is string => !!l);
  }, [product]);

  const creator = useMemo(() => {
    const createAct = activities
      .filter((a) => a.action === 'CREATE' && (a.operator || a.createdBy))
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0];
    if (createAct) {
      return {
        name: createAct.operator || createAct.createdBy || '',
        account: createAct.createdBy || createAct.operator || '',
      };
    }
    return {
      name: user?.realName || user?.username || '系统管理员',
      account: user?.username || user?.role?.code || 'admin',
    };
  }, [activities, user]);

  if (!product) return null;

  const headerGradient = 'linear-gradient(135deg, #f0f7ff 0%, #e0efff 100%)';
  const headerText = 'var(--c-text)';
  const headerTextSub = 'var(--c-text-secondary)';

  const classifyValue = [
    product.crafts?.length ? product.crafts.map((c) => c.name).join('、') : null,
    product.audience?.name || null,
    product.category?.name || null,
  ].filter(Boolean).join(' / ') || '未设置';

  const infoRows = [
    { icon: <ProfileOutlined style={{ fontSize: 14 }} />, label: '编号', value: product.sku || '未填写' },
    {
      icon: <ArrowsAltOutlined style={{ fontSize: 14 }} />,
      label: '尺寸',
      value: [product.sizeL, product.sizeW, product.sizeH].filter((v) => v).join(' × ')
        ? [product.sizeL, product.sizeW, product.sizeH].filter((v) => v).join(' × ') + ' cm'
        : '未设置',
    },
    { icon: <ColumnHeightOutlined style={{ fontSize: 14 }} />, label: '克重', value: product.weight ? `${product.weight} g` : '未设置' },
    { icon: <ColumnWidthOutlined style={{ fontSize: 14 }} />, label: '单位', value: product.unit || '未设置' },
    { icon: <HomeOutlined style={{ fontSize: 14 }} />, label: '模式', value: supplyLabels.join('、') || '未设置' },
  ];

  const circleBtnStyle = (bg: string): React.CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: '50%',
    border: 'none',
    background: bg,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.18s ease',
    outline: 'none',
  });

  const renderSales = () => {
    if (salesLoading) {
      return <div className="pdm-empty-state">加载中…</div>;
    }
    if (!salesList.length) {
      return <Empty description="暂无销售记录" style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }
    return (
      <div className="pm-sales-list">
        {salesList.map((sale) => {
          const meta = STAGE_META[sale.stage];
          const saleAmount = sale.stage === 'ORDER' ? sale.orderAmount : sale.estimatedAmount;
          const saleLabel = sale.stage === 'ORDER' ? '订单金额' : '预估金额';
          const sampleLabel = sale.orderType === 'SAMPLE' ? '打样' : '正式';
          return (
            <div className="pm-sales-item" key={sale.id}>
              <div className="pm-sales-item-main">
                <div className="pm-sales-item-title">
                  <span className="pm-sales-customer">{sale.companyName || sale.title || '未知客户'}</span>
                  <Tag color={sale.orderType === 'SAMPLE' ? 'purple' : 'blue'} style={{ marginInlineEnd: 4 }}>
                    {sampleLabel}
                  </Tag>
                  <Tag color={meta?.color || 'default'} style={{ marginInlineEnd: 0 }}>
                    {meta?.label || sale.stage}
                  </Tag>
                </div>
                <div className="pm-sales-item-sub">
                  <span>商机号：{sale.pipelineNumber}</span>
                  {sale.quantity != null && <span>数量：{sale.quantity}</span>}
                  <span>负责人：{sale.assignee?.realName || sale.assignee?.username || '未分配'}</span>
                  {sale.updateTime && <span>更新：{dayjs(sale.updateTime).format('YYYY-MM-DD')}</span>}
                </div>
              </div>
              <div className="pm-sales-item-right">
                <div className="pm-sales-amount-label">{saleLabel}</div>
                <div className="pm-sales-amount"><Price value={saleAmount} /></div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderActivity = () => {
    if (!activities.length) {
      return <Empty description="暂无跟进动态" style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }
    return (
      <div className="pm-activity">
        {activities.map((act) => {
          const meta = ACTIVITY_META[act.action] || { label: act.action, color: token.colorPrimary };
          return (
            <div className="pm-activity-item" key={act.id}>
              <div className="pm-activity-dot" style={{ background: meta.color }} />
              <div className="pm-activity-content">
                <div className="pm-activity-title">
                  <span className="pm-activity-tag" style={{ color: meta.color, background: `${meta.color}14` }}>
                    {meta.label}
                  </span>
                  {act.operator && <span className="pm-activity-operator">{act.operator}</span>}
                </div>
                {act.detail && <div className="pm-activity-desc">{act.detail}</div>}
                <div className="pm-activity-time">
                  <ClockCircleOutlined /> {dayjs(act.createdAt).format('YYYY-MM-DD HH:mm')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={null}
      closable={false}
      width="1120px"
      maskClosable
      style={{ borderRadius: 20, height: '700px' }}
      bodyStyle={{ overflow: 'hidden', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 }}
    >
      <div style={{ display: 'flex', minHeight: 0, height: '100%', background: token.colorBgContainer }}>
        {/* ==================== 左侧：上半彩色 + 下半白色备注区 ==================== */}
        <div
          style={{
            width: 296,
            minWidth: 296,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            padding: 16,
            borderRadius: '20px 0 0 20px',
            overflow: 'hidden',
            background: token.colorBgContainer,
          }}
        >
          {/* 图片模块：与蓝色区域同级，位于其上方 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
            <ProductImagesStack images={product.images} size={180} maxFan={4} />
          </div>

          {/* 上半：彩色基础信息 */}
          <div
            style={{
              background: headerGradient,
              padding: '22px 22px 20px',
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
              borderRadius: 16,
            }}
          >
            {/* 产品名 */}
            <h2
              style={{
                margin: '10px 0 0',
                fontSize: 17,
                fontWeight: 800,
                color: headerText,
                lineHeight: 1.3,
                wordBreak: 'break-word',
                letterSpacing: '0.01em',
              }}
            >
              {product.name || '-'}
            </h2>

            {/* 分类 */}
            <div style={{ marginTop: 6, fontSize: 13, color: headerTextSub, letterSpacing: '0.01em' }}>
              {classifyValue}
            </div>

            {/* 信息行 */}
            <div
              style={{
                marginTop: 18,
                paddingTop: 16,
                borderTop: '1px solid rgba(22,119,255,0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: 9,
              }}
            >
              {infoRows.map((row, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--c-text)', fontSize: 13 }}>
                  <span style={{ opacity: 0.7, display: 'inline-flex', color: 'var(--c-primary)' }}>{row.icon}</span>
                  <span style={{ opacity: 0.6 }}>{row.label}</span>
                  <span style={{ opacity: row.value === '未设置' || row.value === '未填写' ? 0.6 : 1 }}>{row.value}</span>
                </div>
              ))}
            </div>

            {/* 操作栏：位于模式下方（层级/位置不变，仅重做按钮样式） */}
            <div className="pdm-op-bar">
              <Button
                block
                className="pdm-op-primary"
                onClick={() => onCreateQuote?.(product)}
                icon={<FileTextOutlined />}
              >
                基于此产品创建报价
              </Button>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button
                  block
                  className="pdm-op-ghost"
                  onClick={() => onEdit(product)}
                  icon={<EditOutlined />}
                >
                  编辑产品
                </Button>
                <Button
                  block
                  className="pdm-op-ghost"
                  onClick={() => onApplySample?.(product)}
                  icon={<HomeOutlined />}
                >
                  申请打样
                </Button>
              </div>
            </div>

          </div>

          {/* 下半：产品备注 */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              background: token.colorBgContainer,
              borderRadius: 16,
              border: `1px solid ${token.colorBorderSecondary}`,
              padding: '18px 18px 20px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 700,
                color: token.colorTextSecondary,
                marginBottom: 8,
              }}
            >
              <FileTextOutlined /> 产品备注
            </div>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                fontSize: 14,
                lineHeight: 1.7,
                color: token.colorText,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {product.remark?.trim() || product.description?.trim() ? (
                product.remark || product.description
              ) : (
                <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>暂无</span>
              )}
            </div>
          </div>
        </div>

        {/* ==================== 右侧：内容区 ==================== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* 右上操作栏：tab + 创建人 + 关闭 */}
          <div style={{ padding: '20px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <SegmentedTabBar
              value={tab}
              onChange={(k) => setTab(k as TabKey)}
              activeColor={token.colorPrimary}
              options={[
                { key: 'overview', label: '概览' },
                { key: 'sales', label: '销售记录', count: salesList.length },
                { key: 'activity', label: '跟进动态', count: activities.length },
              ]}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <Tooltip
                title={
                  product.visibility === 'PRIVATE'
                    ? (() => {
                        const ids: string[] = (product.visibleUsers ?? product.visibleUserIds ?? []).map((u) =>
                          typeof u === 'string' ? u : u.userId,
                        );
                        const names = ids.map((id) => userMap?.[id]?.realName || userMap?.[id]?.username || id);
                        return names.length ? `指定人：${names.join('、')}` : '指定人：未设置';
                      })()
                    : undefined
                }
              >
                <Tag
                  style={{
                    margin: 0,
                    color: product.visibility === 'PUBLIC' ? token.colorSuccess : token.colorWarning,
                    backgroundColor: product.visibility === 'PUBLIC' ? `${token.colorSuccess}14` : `${token.colorWarning}14`,
                    borderColor: 'transparent',
                    fontWeight: 600,
                  }}
                >
                  {product.visibility === 'PUBLIC' ? '公开' : '私密'}
                </Tag>
              </Tooltip>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar size={36} style={{ backgroundColor: token.colorPrimary, fontSize: 15, fontWeight: 700 }}>
                  {creator.name?.[0] || '?'}
                </Avatar>
                <div>
                  <div style={{ fontSize: 11, color: token.colorTextTertiary }}>创建人</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: token.colorTextHeading, lineHeight: 1.3 }}>
                    {creator.name || '系统管理员'}
                  </div>
                  <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {creator.account || 'admin'}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                title="关闭"
                style={circleBtnStyle(token.colorFillQuaternary)}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = token.colorFillSecondary; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = token.colorFillQuaternary; }}
                onFocus={(e) => { e.currentTarget.style.boxShadow = `0 0 0 3px ${token.colorFillSecondary}`; }}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
              >
                <CloseOutlined style={{ color: token.colorTextSecondary }} />
              </button>
            </div>
          </div>

          {/* 内容区 */}
          <div style={{ flex: 1, padding: '20px 16px 0', overflow: 'auto', height: 520 }}>
            {tab === 'overview' && <ProductOverview product={product} salesList={salesList} loading={salesLoading} />}
            {tab === 'sales' && renderSales()}
            {tab === 'activity' && renderActivity()}
          </div>
        </div>
      </div>
    </AppModal>
  );
};

// 活动元信息（产品）
const ACTIVITY_META: Record<string, { label: string; color: string }> = {
  CREATE: { label: '创建产品', color: '#1677ff' },
  UPDATE: { label: '更新资料', color: '#16a34a' },
  PRICE: { label: '价格变动', color: '#d97706' },
  IMAGE: { label: '更新图片', color: '#0891b2' },
  CATEGORY: { label: '调整分类', color: '#7c3aed' },
  VISIBILITY: { label: '调整可见范围', color: '#db2777' },
  DELETE: { label: '删除产品', color: '#dc2626' },
  ASSIGN: { label: '分配负责人', color: '#0d9488' },
};

export default ProductDetailModal;
