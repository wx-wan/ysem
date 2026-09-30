import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { App, Button, Popconfirm, Spin, Tabs, Tag } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getSalesLogs, type OperationLogItem } from '../../api/operationLog';
import OperationLogTimeline from '../common/OperationLogTimeline';
import { getStageMeta, getStageI18nKey } from './stages';
import { getIntentLabel } from './SalesFormModal';
import Price from '../common/Price';
import type { SalesItem } from '../../api/sales';

interface Props {
  detail: SalesItem | null;
  loading?: boolean;
  isAdmin?: boolean;
  onClose?: () => void;
  onEdit: (item: SalesItem) => void;
  onDelete: (item: SalesItem) => void;
}

/** 占位符与线索详情面板保持一致（em dash，非半角连字符） */
const PLACEHOLDER = '—';

/**
 * 商机详情侧边面板 —— 结构与样式**对齐线索详情面板**（`LeadDetailPanel`）：
 * 同为 `lead-detail-panel` 骨架（渐变头部 + Tabs + 底部操作条），
 * 头部展示「编号 + 阶段」/ 公司 / 商机标题 / 创建时间；
 * 内容区用 `lead-wizard-summary` 分节（基本信息 / 关联产品）；
 * 空态、Tab 尺寸与内边距、底部分隔线（实线，模块主次边界）均与线索一致。
 */
export default function OpportunityDetailPanel({ detail, loading, isAdmin, onClose, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [logs, setLogs] = useState<OperationLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!detail?.id) return;
    setLogsLoading(true);
    try {
      // getSalesLogs 已解包到数组（后端 data.list）
      const list = await getSalesLogs(detail.id);
      setLogs(list ?? []);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLogsLoading(false);
    }
  }, [detail?.id, message, t]);

  useEffect(() => {
    if (detail?.id) loadLogs();
  }, [detail?.id, loadLogs]);

  if (!detail) {
    return (
      <div className="lead-detail-panel__empty">
        {loading ? <Spin /> : t('sales.emptyPanel')}
      </div>
    );
  }

  const stage = detail.stage ?? '';
  const meta = getStageMeta(stage);
  // 后端契约：公司 / 联系人取 customer.*，负责人取 owner.*（无顶层 companyName / assignee）
  const company = detail.customer?.companyName || PLACEHOLDER;
  const contactName = detail.customer?.contactName || PLACEHOLDER;
  const ownerName = detail.owner?.realName || detail.owner?.username || '';
  const channelText = detail.channel?.name
    ? `${detail.channel.name}${detail.shop?.name ? ` / ${detail.shop.name}` : ''}`
    : PLACEHOLDER;
  // 采购意向：优先 V1.0 intentLevel，回退旧版 probability（中文文案 / 数字字符串）
  const intentText = detail.intentLevel
    ? t(`sales.prob.${detail.intentLevel.toLowerCase()}`)
    : getIntentLabel(detail.probability == null ? '' : String(detail.probability)) || PLACEHOLDER;
  // Decimal 序列化为字符串，展示前归一为数字
  const amount = detail.estimatedAmount == null ? null : Number(detail.estimatedAmount);
  const products = detail.items || [];
  const stageText = t(`sales.stage.${getStageI18nKey(stage)}`);
  const leadText = detail.leadId
    ? `${detail.lead?.leadNo || detail.leadId}${detail.lead?.leadName ? `（${detail.lead.leadName}）` : ''}`
    : PLACEHOLDER;

  // 基本信息行（口径与线索详情面板的「基本信息」一致：标签次要色 + 值主色）
  const summaryRows: { label: string; value: ReactNode }[] = [
    { label: t('sales.sourceLead'), value: leadText },
    { label: t('sales.title_field'), value: detail.title || PLACEHOLDER },
    {
      label: t('sales.stage.label'),
      value: detail.stage ? (
        <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
          {stageText}
        </Tag>
      ) : (
        PLACEHOLDER
      ),
    },
    { label: t('sales.customer'), value: company },
    { label: t('sales.contact'), value: contactName },
    { label: t('sales.sourceChannel'), value: channelText },
    { label: t('sales.owner'), value: ownerName || t('sales.unassigned') },
    { label: t('sales.probability'), value: intentText },
    { label: t('sales.estAmount'), value: amount != null && amount !== 0 ? <Price value={amount} /> : PLACEHOLDER },
    {
      label: t('sales.estCloseDate'),
      value: detail.estimatedCloseDate ? String(detail.estimatedCloseDate).slice(0, 10) : PLACEHOLDER,
    },
    { label: t('sales.opportunityNotes'), value: detail.notes || PLACEHOLDER },
    { label: t('sales.createdAt'), value: detail.createdAt?.slice(0, 10) || PLACEHOLDER },
  ];

  const infoTab = (
    <div style={{ paddingBottom: 12 }}>
      <div className="lead-wizard-summary">
        <div className="lead-wizard-summary__title">{t('sales.basicInfo')}</div>
        {summaryRows.map((row) => (
          <div key={row.label} className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{row.label}</span>
            <span className="lead-wizard-summary__value">{row.value}</span>
          </div>
        ))}
      </div>

      <div className="lead-wizard-summary" style={{ marginTop: 12 }}>
        <div className="lead-wizard-summary__title">
          {t('sales.relatedProducts')}
          {products.length > 0 && <Tag style={{ marginLeft: 6 }}>{products.length}</Tag>}
        </div>
        {products.length === 0 ? (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>{t('sales.noProducts')}</div>
        ) : (
          products.map((it) => (
            <div key={it.id} className="lead-wizard-summary__row">
              <span className="lead-wizard-summary__label">
                {it.productName || it.product?.name || it.productId}
              </span>
              <span className="lead-wizard-summary__value">×{it.quantity ?? 1}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="lead-detail-panel">
      <div className="lead-detail-panel__header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              {detail.opportunityNo || detail.title}
            </span>
            {detail.stage && (
              <Tag color={meta.color} icon={meta.icon} style={{ marginInlineEnd: 0 }}>
                {stageText}
              </Tag>
            )}
          </div>
          {onClose && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={onClose}
              style={{ color: '#fff', flexShrink: 0 }}
            />
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700 }}>{company}</div>
        {detail.title && (
          <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{detail.title}</div>
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.78)', display: 'flex', gap: 12 }}>
          <span>
            {t('sales.createdAt')}：{detail.createdAt?.slice(0, 10)}
          </span>
        </div>
      </div>

      <Spin spinning={loading}>
        <div style={{ padding: '12px 16px 0' }}>
          <Tabs
            size="small"
            defaultActiveKey="detail"
            items={[
              { key: 'detail', label: t('sales.tabBasic'), children: infoTab },
              {
                key: 'logs',
                label: t('sales.tabLogs'),
                children: (
                  <div style={{ paddingBottom: 12, minHeight: 80 }}>
                    <OperationLogTimeline logs={logs} loading={logsLoading} />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Spin>

      {/* 底部操作条与内容之间属模块间主次边界：实线 + 强分隔色（分割线规范）；
          线用 margin 收进内容宽度，两端与上方文本对齐，不做通栏（与线索详情面板一致） */}
      <div
        style={{
          flexShrink: 0,
          margin: '0 16px',
          padding: '12px 0',
          borderTop: '1px solid var(--c-border-strong, #e2e8f0)',
          display: 'flex',
          gap: 8,
        }}
      >
        <Button type="primary" style={{ flex: 1 }} onClick={() => onEdit(detail)}>
          {t('common.edit')}
        </Button>
        {isAdmin && (
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => onDelete(detail)}>
            <Button danger>{t('common.delete')}</Button>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}
