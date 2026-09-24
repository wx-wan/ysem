import { useEffect, useState } from 'react';
import { Button, Popconfirm, Spin, Tabs, Tag, Timeline, Tooltip } from 'antd';
import { ExclamationCircleOutlined, FormOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import FlagIcon from '../FlagIcon';
import { leadApi, type Lead, type LeadOperationLog } from '../../api/lead';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { formatMoneyValue } from '../common/MoneyInput';
import { STATUS_META } from './constants';

/** 操作记录动作 → i18n key + 时间线颜色 */
const LOG_ACTION_META: Record<string, { key: string; color: string }> = {
  CREATE: { key: 'lead.logCreate', color: 'green' },
  UPDATE: { key: 'lead.logUpdate', color: 'blue' },
  DELETE: { key: 'lead.logDelete', color: 'red' },
  CLAIM: { key: 'lead.logClaim', color: 'cyan' },
  RELEASE: { key: 'lead.logRelease', color: 'orange' },
  TRANSFERRED: { key: 'lead.logTransferred', color: 'purple' },
  STATUS: { key: 'lead.logStatus', color: 'gold' },
};

/** 解析日志 diff JSON（[{field,label,beforeText,afterText}]） */
const parseLogDiff = (raw?: string | null): { field: string; label: string; beforeText: string; afterText: string }[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

interface Props {
  /** 详情数据（父级按选中 id 拉取完整信息） */
  detail: Lead | null;
  loading: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onEdit: (record: Lead) => void;
  onConvert: (record: Lead) => void;
  onClaim: (record: Lead) => void;
  onRelease: (record: Lead) => void;
  onRemove: (id: string) => void;
}

/**
 * 线索详情侧边面板（卡片列表联动）：
 * 紫色渐变头部（编号 + 状态 / 客户 + 国旗 / 产品 / 数量与日期），
 * Tabs：详细信息（客户需求 + 基本信息）/ 跟进记录（联系方式 + 备注 + 状态时间），
 * 底部操作：确认转商机 / 编辑 / 释放 / 删除（公海仅认领）。
 */
export default function LeadDetailPanel({
  detail,
  loading,
  isAdmin,
  onClose,
  onEdit,
  onConvert,
  onClaim,
  onRelease,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const { currencies } = useCurrencyStore();
  // 操作记录（操作日志）：随选中线索变化重新拉取
  const [logs, setLogs] = useState<LeadOperationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const leadId = detail?.id;
  useEffect(() => {
    if (!leadId) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLogsLoading(true);
    leadApi
      .getLogs(leadId)
      .then((res) => {
        if (!cancelled) setLogs(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (!detail) {
    return (
      <div className="lead-detail-panel__empty">
        {loading ? <Spin /> : t('lead.emptyPanel')}
      </div>
    );
  }

  const statusMeta = STATUS_META[detail.status];

  const company = detail.customer?.companyName || detail.companyName || '—';
  const country = detail.targetMarket || detail.country || '';
  const product = detail.items?.[0]?.productName || detail.productName || detail.productInterest || '';
  const ownerName = detail.owner?.realName || detail.owner?.username || '';
  const isPool = !detail.ownerId;
  // 已推进（已确认 / 已打样 / 已成交）的线索只读
  const readonly = detail.status !== 'NEW';
  // 头部联系方式：行内展示首条「沟通工具：账号」，多条时以 icon 悬停查看全部
  const contactList = Array.isArray(detail.contactMethods) ? detail.contactMethods : [];
  const primaryContact = contactList[0];
  const contactText = primaryContact
    ? `${primaryContact.tool || '—'}：${primaryContact.account || '—'}`
    : '';
  const hasMoreContacts = contactList.length > 1;

  const summaryRows = [
    { label: t('lead.fieldLeadNo'), value: detail.leadNo || '—' },
    { label: t('lead.companyName'), value: company },
    { label: t('lead.product'), value: product || '—' },
    { label: t('lead.quantityRequirement'), value: detail.quantity != null ? `${detail.quantity}${detail.unit || '个'}` : '—' },
    {
      label: t('lead.targetPrice'),
      // 目标价位：展示录入时的币种 + 金额（换算统一用落库的汇率快照，见 MoneyInput）
      value:
        formatMoneyValue(
          {
            currency: detail.currency ?? 'CNY',
            amount: detail.targetPrice != null && detail.targetPrice !== '' ? Number(detail.targetPrice) || null : null,
            exchangeRate: Number(detail.targetPriceRate ?? 1) || 1,
          },
          currencies,
        ) || '—',
    },
    { label: t('lead.expectedDelivery'), value: detail.expectedDelivery ? dayjs(detail.expectedDelivery).format('YYYY-MM-DD') : '—' },
    {
      label: t('lead.channel'),
      value: [detail.channel?.name, detail.shop?.name].filter(Boolean).join(' · ') || '—',
    },
    { label: t('lead.assignee'), value: ownerName || t('sales.unassigned') },
    { label: t('lead.createdAt'), value: detail.createdAt?.slice(0, 10) || '—' },
  ];

  return (
    <div className="lead-detail-panel">
      <div className="lead-detail-panel__header">
        {/* 卡片「收起」承担关闭面板职责，右上角改为编辑入口 */}
        <Tooltip title={t('common.edit')}>
          <button type="button" className="lead-detail-panel__edit" onClick={() => onEdit(detail)}>
            <FormOutlined />
          </button>
        </Tooltip>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 40 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{detail.leadNo || detail.leadName}</span>
          {statusMeta && (
            <Tag color={statusMeta.color} style={{ marginInlineEnd: 0 }}>
              {t(statusMeta.label)}
            </Tag>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          {country && <FlagIcon country={country} style={{ width: 20, height: 15, borderRadius: 2 }} />}
          <span>{company}</span>
        </div>
        {/* 联系人 + 首条联系方式（沟通工具：账号）；多条时 icon 悬停查看全部 */}
        <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {detail.contactName ? <span>{detail.contactName}</span> : null}
          {contactText && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span>{contactText}</span>
              {hasMoreContacts && (
                <Tooltip
                  color="white"
                  // 白底浮层：8/12 内边距（4 刻度）、细边框 + 两级阴影定边界，圆角走 --radius-sm
                  // antd 6：overlayInnerStyle 已弃用，改用语义化 styles.container
                  styles={{
                    container: {
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm, 8px)',
                      border: '1px solid var(--c-border-strong, #e2e8f0)',
                      boxShadow: 'var(--shadow-hover, 0 8px 24px rgba(0, 0, 0, 0.08))',
                      color: 'var(--c-text, #1e293b)',
                      fontSize: 13,
                      lineHeight: 1.5,
                    },
                  }}
                  title={
                    <div style={{ display: 'grid', gap: 6, minWidth: 140 }}>
                      {contactList.map((c, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ color: 'var(--c-text-tertiary, #94a3b8)', flexShrink: 0 }}>
                            {c.tool || '—'}
                          </span>
                          <span style={{ wordBreak: 'break-all' }}>{c.account || '—'}</span>
                        </div>
                      ))}
                    </div>
                  }
                >
                  <ExclamationCircleOutlined style={{ cursor: 'help', fontSize: 14, opacity: 0.9 }} />
                </Tooltip>
              )}
            </span>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.78)', display: 'flex', gap: 12 }}>
          <span>{t('lead.createdAt')}：{detail.createdAt?.slice(0, 10)}</span>
        </div>
      </div>

      <Spin spinning={loading}>
        <div style={{ padding: '12px 16px 0' }}>
          <Tabs
            size="small"
            defaultActiveKey="detail"
            items={[
              {
                key: 'detail',
                label: t('lead.tabDetail'),
                children: (
                  <div style={{ paddingBottom: 12 }}>
                    <div className="lead-wizard-summary">
                      <div className="lead-wizard-summary__title">{t('lead.customerReq')}</div>
                      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', whiteSpace: 'pre-wrap' }}>
                        {detail.items?.[0]?.productDesc || detail.productDesc || '—'}
                      </div>
                    </div>
                    <div className="lead-wizard-summary" style={{ marginTop: 12 }}>
                      <div className="lead-wizard-summary__title">{t('lead.basicInfo')}</div>
                      {summaryRows.map((row) => (
                        <div key={row.label} className="lead-wizard-summary__row">
                          <span className="lead-wizard-summary__label">{row.label}</span>
                          <span className="lead-wizard-summary__value">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              },
              {
                key: 'logs',
                label: t('lead.tabOperationLogs'),
                children: (
                  <div style={{ paddingBottom: 12, minHeight: 80 }}>
                    <Spin spinning={logsLoading}>
                      {logs.length ? (
                        <Timeline
                          items={logs.map((log) => {
                            const meta = LOG_ACTION_META[log.action];
                            const diffItems = parseLogDiff(log.diff);
                            return {
                              key: log.id,
                              color: meta?.color ?? 'blue',
                              // antd 6：items.children 已弃用，改用 items.content
                              content: (
                                <div style={{ fontSize: 13 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {meta ? (
                                      <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
                                        {t(meta.key)}
                                      </Tag>
                                    ) : (
                                      <Tag style={{ marginInlineEnd: 0 }}>{log.action}</Tag>
                                    )}
                                    <span style={{ color: 'rgba(0,0,0,0.85)' }}>{log.summary || '—'}</span>
                                  </div>
                                  {diffItems.length > 0 && (
                                    <div
                                      style={{
                                        marginTop: 4,
                                        display: 'grid',
                                        gap: 2,
                                        padding: '6px 8px',
                                        background: 'var(--c-bg, #f8fafc)',
                                        borderRadius: 'var(--radius-pill, 6px)',
                                        fontSize: 12,
                                        lineHeight: 1.5,
                                        color: 'rgba(0,0,0,0.65)',
                                      }}
                                    >
                                      {diffItems.map((d) => (
                                        <span key={d.field}>
                                          {d.label}：
                                          <span style={{ color: 'rgba(0,0,0,0.45)' }}>{d.beforeText}</span>
                                          {' → '}
                                          <span style={{ color: 'var(--c-text, #1e293b)' }}>{d.afterText}</span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div style={{ marginTop: 4, fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                                    {log.realName || log.username}
                                    {log.createdAt ? ` · ${dayjs(log.createdAt).format('YYYY-MM-DD HH:mm')}` : ''}
                                  </div>
                                </div>
                              ),
                            };
                          })}
                        />
                      ) : (
                        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', padding: '12px 0' }}>
                          {t('lead.logEmpty')}
                        </div>
                      )}
                    </Spin>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Spin>

      {/* 底部操作条与内容之间属模块间主次边界：实线 + 强分隔色（分割线规范）。
          线用 margin 收进内容宽度，两端与上方文本对齐，不做通栏 */}
      <div style={{ flexShrink: 0, margin: '0 16px', padding: '12px 0', borderTop: '1px solid var(--c-border-strong, #e2e8f0)', display: 'flex', gap: 8 }}>
        {isPool ? (
          <Button type="primary" block onClick={() => onClaim(detail)}>
            {t('lead.claim')}
          </Button>
        ) : (
          <>
            <Button
              type="primary"
              style={{ flex: 1 }}
              disabled={readonly}
              onClick={() => onConvert(detail)}
            >
              {t('lead.confirmLead')}
            </Button>
            <Button disabled={readonly} onClick={() => onRelease(detail)}>
              {t('lead.release')}
            </Button>
            {isAdmin && (
              <Popconfirm title={t('common.confirmDelete')} onConfirm={() => onRemove(detail.id)}>
                <Button danger disabled={readonly}>
                  {t('common.delete')}
                </Button>
              </Popconfirm>
            )}
          </>
        )}
      </div>
    </div>
  );
}
