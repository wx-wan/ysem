import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppModal from '../../AppModal';
import { Avatar, Button, Empty, Tag, theme, Tooltip } from 'antd';
import {
  EditOutlined, CloseOutlined,
  ProfileOutlined, ArrowsAltOutlined, ColumnHeightOutlined,
  HomeOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../../stores/useAuthStore';
import { Product } from '../../../api/products';
import { ProductOpportunityItem } from '../../../api/sales';
import { leadApi, type Lead } from '../../../api/lead';
import SalesRecordCard from '../../common/SalesRecordCard';
import { getProductLogs, type OperationLogItem } from '../../../api/operationLog';
import OperationLogTimeline from '../../common/OperationLogTimeline';
import { getStageMeta, getStageI18nKey } from '../../sales/stages';
import { quotationApi, QUOTATION_STATUS_TEXT, QUOTATION_STATUS_COLOR } from '../../../api/quotations';
import { sampleOrderApi, SAMPLE_STATUS_TEXT, SAMPLE_STATUS_COLOR } from '../../../api/sampleOrders';
import { salesOrderApi, SALES_ORDER_STATUS_TEXT, SALES_ORDER_STATUS_COLOR } from '../../../api/salesOrders';
import ProductOverview from './ProductOverview';
import Price from '../../common/Price';
import SegmentedTabBar from '../../common/SegmentedTabBar';
import ProductImagesStack from '../../common/ProductImagesStack';
import dayjs from 'dayjs';
import './ProductDetailModal.css';

type TabKey = 'overview' | 'sales' | 'activity';

// ========== 产品关联单据（纯 UI view model，不落库、不写回 schema）==========
// ADR-6B-02：产品关联单据保持「报价 / 打样 / 销售订单」三类业务语义，
// 三类各自使用自己的 V1.0 编号与状态，不再使用 legacy Order 的 type/status union。
type RelatedBusinessType = 'QUOTATION' | 'SAMPLE_ORDER' | 'SALES_ORDER';

interface RelatedBusinessDocument {
  id: string;
  businessType: RelatedBusinessType;
  businessNo: string;
  status: string;
  statusText: string;
  statusColor: string;
  /** Decimal 经 JSON 到达前端为字符串 → 统一 Number() 归一；非法/空值 → null（展示 '-'） */
  amount: number | null;
  currency?: string | null;
  customerName?: string;
  createdAt?: string;
  /** 归属人（后端 ownerId 标量）；用于「仅查看本人销售记录」过滤 */
  ownerId?: string | null;
}

const RELATED_BUSINESS_LABEL: Record<RelatedBusinessType, string> = {
  QUOTATION: '报价',
  SAMPLE_ORDER: '打样',
  SALES_ORDER: '销售订单',
};

const RELATED_BUSINESS_COLOR: Record<RelatedBusinessType, string> = {
  QUOTATION: 'blue',
  SAMPLE_ORDER: 'orange',
  SALES_ORDER: 'green',
};

// 线索状态 / 来源标签（与客户「销售记录」中的线索卡片一致）
const LEAD_STATUS_LABEL: Record<string, string> = {
  NEW: '新线索',
  CONFIRMED: '已确认',
  SAMPLED: '已打样',
  WON: '已成交',
};
const LEAD_SOURCE_LABEL: Record<string, string> = {
  MANUAL: '手动录入',
  EXCEL: 'Excel 导入',
  RPA: 'RPA 抓取',
  SYNC: '同步',
};

/** Decimal / null 安全归一：非法值返回 null */
const toAmount = (v?: string | number | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

interface ProductDetailModalProps {
  product: Product | null;
  open: boolean;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onDelete: () => void;
  canDelete?: boolean;
  salesList: ProductOpportunityItem[];
  salesLoading: boolean;
  onSalesRefresh?: () => void;
}

const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product, open, onClose, onEdit,
  salesList, salesLoading,
}) => {
  // 操作记录：从 OperationLog 按 businessType=PRODUCT 捞取（单一日志库，不重复建记录）
  const [logs, setLogs] = useState<OperationLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  useEffect(() => {
    if (!open || !product?.id) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLogsLoading(true);
    getProductLogs(product.id)
      .then((list) => { if (!cancelled) setLogs(list); })
      .catch(() => { if (!cancelled) setLogs([]); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [open, product?.id]);
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { user } = useAuthStore();
  const currentUserId = user?.id;
  const isAdmin = user?.role?.code === 'admin' || user?.role?.code === 'ADMIN';
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('overview');
  const [relatedDocs, setRelatedDocs] = useState<RelatedBusinessDocument[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadsLoading, setLeadsLoading] = useState(false);

  useEffect(() => {
    if (open) setTab('overview');
  }, [open, product?.id]);

  // 加载该产品的相关单据：V1.0 三类业务列表并行（各自 productId 服务端过滤）
  const loadRelatedOrders = useCallback(() => {
    if (!open || !product) {
      setRelatedDocs([]);
      return;
    }
    const params = { productId: product.id, pageSize: 50 };
    setRelatedLoading(true);
    // allSettled：任一业务接口失败不影响其余两类；失败项显式告警，不静默吞错
    Promise.allSettled([
      quotationApi.list(params),
      sampleOrderApi.list(params),
      salesOrderApi.list(params),
    ])
      .then(([quotation, sample, salesOrder]) => {
        const docs: RelatedBusinessDocument[] = [];

        if (quotation.status === 'fulfilled') {
          for (const r of quotation.value.data?.data?.list ?? []) {
            docs.push({
              id: r.id,
              businessType: 'QUOTATION',
              businessNo: r.quotationNo,
              status: r.status,
              statusText: (QUOTATION_STATUS_TEXT as Record<string, string>)[r.status] ?? r.status,
              statusColor: (QUOTATION_STATUS_COLOR as Record<string, string>)[r.status] ?? 'default',
              amount: toAmount(r.totalAmount),
              currency: r.currency,
              customerName: r.customer?.companyName,
              createdAt: r.createdAt,
              ownerId: r.ownerId ?? null,
            });
          }
        } else {
          console.warn('[ProductDetailModal] 加载关联报价单失败', quotation.reason);
        }

        if (sample.status === 'fulfilled') {
          for (const r of sample.value.data?.data?.list ?? []) {
            docs.push({
              id: r.id,
              businessType: 'SAMPLE_ORDER',
              businessNo: r.sampleNo,
              status: r.status,
              statusText: (SAMPLE_STATUS_TEXT as Record<string, string>)[r.status] ?? r.status,
              statusColor: (SAMPLE_STATUS_COLOR as Record<string, string>)[r.status] ?? 'default',
              amount: toAmount(r.feeAmount),
              currency: r.feeCurrency,
              customerName: r.customer?.companyName,
              createdAt: r.createdAt,
              ownerId: r.ownerId ?? null,
            });
          }
        } else {
          console.warn('[ProductDetailModal] 加载关联打样单失败', sample.reason);
        }

        if (salesOrder.status === 'fulfilled') {
          for (const r of salesOrder.value.data?.data?.list ?? []) {
            docs.push({
              id: r.id,
              businessType: 'SALES_ORDER',
              businessNo: r.orderNo,
              status: r.status,
              statusText: (SALES_ORDER_STATUS_TEXT as Record<string, string>)[r.status] ?? r.status,
              statusColor: (SALES_ORDER_STATUS_COLOR as Record<string, string>)[r.status] ?? 'default',
              amount: toAmount(r.totalAmount),
              currency: r.currency,
              customerName: r.customer?.companyName,
              createdAt: r.createdAt,
              ownerId: r.ownerId ?? null,
            });
          }
        } else {
          console.warn('[ProductDetailModal] 加载关联销售订单失败', salesOrder.reason);
        }

        docs.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
        setRelatedDocs(docs);
      })
      .finally(() => setRelatedLoading(false));
  }, [open, product?.id]);

  useEffect(() => {
    loadRelatedOrders();
  }, [loadRelatedOrders]);

  // 加载关联该产品的线索（已转化商机的线索由「商机」承接，避免重复展示；与客户「销售记录」一致）
  const loadLeads = useCallback(() => {
    if (!open || !product) {
      setLeads([]);
      return;
    }
    setLeadsLoading(true);
    leadApi.list({ productId: product.id, pageSize: 50 })
      .then((r) => {
        const list = (r.data?.list ?? []).filter((l) => !l.pipelineId);
        setLeads(list);
      })
      .catch(() => setLeads([]))
      .finally(() => setLeadsLoading(false));
  }, [open, product?.id]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const creator = useMemo(() => {
    const createAct = logs
      .filter((a) => a.action === 'CREATE' || a.action === 'CREATED')
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0];
    if (createAct) {
      return {
        name: createAct.realName || createAct.username || '系统管理员',
        account: createAct.username || 'admin',
      };
    }
    return {
      name: user?.realName || user?.username || '系统管理员',
      account: user?.username || 'admin',
    };
  }, [logs, user]);

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
    {
      icon: <HomeOutlined style={{ fontSize: 14 }} />,
      label: '类型',
      value: '单品',
    },
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

  // 销售记录（统一模块）：商机 / 报价 / 打样 / 销售订单 / 线索 合并为同一列表，按时间倒序排列。
  // 卡片样式与交互统一收口到 common/SalesRecordCard，产品与客户共用，避免两边重复维护。
  const renderSalesRecords = () => {
    if (relatedLoading || salesLoading || leadsLoading) {
      return <div className="pdm-empty-state">加载中…</div>;
    }
    // 归一为统一记录并按时间倒序
    const unified: Array<
      | { kind: 'related'; ts: string; data: RelatedBusinessDocument }
      | { kind: 'opportunity'; ts: string; data: ProductOpportunityItem }
      | { kind: 'lead'; ts: string; data: Lead }
    > = [
      ...relatedDocs.map((d) => ({ kind: 'related' as const, ts: d.createdAt || '', data: d })),
      // by-product 投影不返回 createdAt，只有 updateTime
      ...salesList.map((s) => ({ kind: 'opportunity' as const, ts: s.updateTime || '', data: s })),
      ...leads.map((l) => ({ kind: 'lead' as const, ts: l.createdAt || '', data: l })),
    ].sort((a, b) => dayjs(b.ts).valueOf() - dayjs(a.ts).valueOf());

    // 仅展示本人销售记录；但若当前用户是产品的「指定人」，可额外查看「创建人」的销售记录
    const recordOwnerId = (rec: (typeof unified)[number]): string | undefined => {
      if (rec.kind === 'related') return rec.data.ownerId ?? undefined;
      if (rec.kind === 'opportunity') return rec.data.assignee?.id;
      return rec.data.owner?.id; // lead
    };
    const designatedIds = product?.visibleUserIds
      ?? product?.visibleUsers?.map((v) => v.userId)
      ?? [];
    const isDesignated = !!currentUserId && designatedIds.includes(currentUserId);
    const creatorId = product?.createdBy ?? undefined;
    const visible = !currentUserId || isAdmin
      ? unified
      : unified.filter((rec) => {
          const ownerId = recordOwnerId(rec);
          if (ownerId === currentUserId) return true; // 本人记录恒可见
          // 指定人额外可见创建人的记录
          if (isDesignated && creatorId && ownerId === creatorId) return true;
          return false;
        });

    if (!visible.length) {
      return <Empty description="暂无销售记录" style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {visible.map((rec) => {
          if (rec.kind === 'related') {
            const doc = rec.data;
            const navTo =
              doc.businessType === 'QUOTATION'
                ? () => navigate(`/sales/quotes?quotationId=${doc.id}`)
                : doc.businessType === 'SAMPLE_ORDER'
                ? () => navigate(`/sales/samples?sampleOrderId=${doc.id}`)
                : () => navigate(`/sales/orders?salesOrderId=${doc.id}`);
            return (
              <SalesRecordCard
                key={`${doc.businessType}-${doc.id}`}
                typeLabel={RELATED_BUSINESS_LABEL[doc.businessType]}
                typeColor={RELATED_BUSINESS_COLOR[doc.businessType]}
                statusLabel={doc.statusText || undefined}
                statusColor={doc.statusColor}
                title={doc.businessNo || doc.id.slice(0, 8)}
                createdAt={doc.createdAt}
                onClick={navTo}
                detail={(
                  <>
                    <span>客户：{doc.customerName || '-'}</span>
                    <span>金额：{doc.amount === null ? '-' : <Price value={doc.amount} />}</span>
                  </>
                )}
              />
            );
          }
          // 商机
          if (rec.kind === 'opportunity') {
            const sale = rec.data;
            const meta = getStageMeta(sale.stage ?? '');
            // 商机只有预估金额（订单金额在关联销售订单上，见上方 relatedDocs）
            const saleAmount = sale.estimatedAmount == null ? null : Number(sale.estimatedAmount);
            return (
              <SalesRecordCard
                key={sale.id}
                typeLabel="商机"
                typeColor="blue"
                statusLabel={t(`sales.stage.${getStageI18nKey(sale.stage ?? '')}`)}
                statusColor={meta?.color || 'default'}
                title={sale.companyName || sale.title || '未知客户'}
                createdAt={sale.updateTime || ''}
                onClick={() => navigate(`/sales/opportunities?pipelineId=${sale.id}`)}
                detail={(
                  <>
                    {sale.opportunityNo && <span>商机号：{sale.opportunityNo}</span>}
                    {sale.quantity != null && <span>数量：{sale.quantity}</span>}
                    {(sale.assignee?.realName || sale.assignee?.username) && <span>负责人：{sale.assignee?.realName || sale.assignee?.username}</span>}
                    <span>预估金额：<Price value={saleAmount} /></span>
                  </>
                )}
              />
            );
          }
          // 线索（已转化商机的线索已在「商机」中展示，此处不再重复）
          const lead = rec.data;
          const leadStatusLabel = LEAD_STATUS_LABEL[lead.status] || '新线索';
          const leadSourceLabel = LEAD_SOURCE_LABEL[lead.source || 'MANUAL'] || '手动录入';
          return (
            <SalesRecordCard
              key={lead.id}
              typeLabel="线索"
              typeColor="blue"
              statusLabel={leadStatusLabel}
              statusColor="gold"
              title={lead.leadName || '-'}
              createdAt={lead.createdAt}
              onClick={() => navigate(`/sales/leads?leadId=${lead.id}`)}
              detail={(
                <>
                  {lead.leadNo && <span>编号：{lead.leadNo}</span>}
                  <span>来源：{leadSourceLabel}</span>
                  {(lead.owner?.realName || lead.owner?.username) && <span>负责人：{lead.owner?.realName || lead.owner?.username}</span>}
                </>
              )}
            />
          );
        })}
      </div>
    );
  };

  const renderActivity = () => (
    <OperationLogTimeline logs={logs} loading={logsLoading} />
  );

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
            gap: 16,
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
              padding: 16,
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

            {/* 操作栏：仅保留编辑（基于产品创建报价 / 申请打样 已从产品详情移除） */}
            {/* 编辑权限：仅创建人 + 指定可见人 + 管理员（后端 canEdit 计算） */}
            {product.canEdit === true && (
              <div className="pdm-op-bar">
                <Button
                  block
                  className="pdm-op-ghost"
                  onClick={() => onEdit(product)}
                  icon={<EditOutlined />}
                >
                  编辑产品
                </Button>
              </div>
            )}

          </div>

          {/* 下半：产品备注 */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              background: token.colorBgContainer,
              borderRadius: 16,
              border: `1px solid ${token.colorBorderSecondary}`,
              padding: 16,
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
              <FileTextOutlined /> 产品描述
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
              {product.description?.trim() ? (
                product.description
              ) : (
                <span style={{ color: token.colorTextTertiary, fontSize: 13 }}>暂无</span>
              )}
            </div>
          </div>
        </div>

        {/* ==================== 右侧：内容区 ==================== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {/* 右上操作栏：tab + 创建人 + 关闭 */}
          <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <SegmentedTabBar
              value={tab}
              onChange={(k) => setTab(k as TabKey)}
              activeColor={token.colorPrimary}
              options={[
                { key: 'overview', label: '概览' },
                { key: 'sales', label: '销售记录', count: relatedDocs.length + salesList.length + leads.length },
                { key: 'activity', label: '操作记录', count: logs.length },
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
                        return ids.length ? `指定人：${ids.join('、')}` : '指定人：未设置';
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
          <div style={{ flex: 1, minHeight: 0, padding: 16, overflow: 'auto' }}>
            {tab === 'overview' && <ProductOverview product={product} salesList={salesList} loading={salesLoading} />}
            {tab === 'sales' && renderSalesRecords()}
            {tab === 'activity' && renderActivity()}
          </div>
        </div>
      </div>
    </AppModal>
  );
};

export default ProductDetailModal;
