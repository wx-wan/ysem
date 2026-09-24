import { Button, Popconfirm, Spin, Tabs, Tag } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import FlagIcon from '../FlagIcon';
import { type Lead } from '../../api/lead';
import { STATUS_META } from './constants';

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
  const readonly = detail.status === 'QUALIFIED';
  const contactList = Array.isArray(detail.contactMethods) ? detail.contactMethods : [];

  const summaryRows = [
    { label: t('lead.fieldLeadNo'), value: detail.leadNo || '—' },
    { label: t('lead.companyName'), value: company },
    { label: t('lead.product'), value: product || '—' },
    { label: t('lead.quantityRequirement'), value: detail.quantity ?? '—' },
    { label: t('lead.targetPrice'), value: detail.targetPrice || '—' },
    { label: t('lead.deliveryReq'), value: detail.deliveryReq || '—' },
    {
      label: t('lead.channel'),
      value: [detail.channel?.name, detail.shop?.name].filter(Boolean).join(' / ') || '—',
    },
    { label: t('lead.assignee'), value: ownerName || t('sales.unassigned') },
    { label: t('lead.createdAt'), value: detail.createdAt?.slice(0, 10) || '—' },
  ];

  return (
    <div className="lead-detail-panel">
      <div className="lead-detail-panel__header">
        <button type="button" className="lead-wizard-header__close" onClick={onClose}>
          <CloseOutlined />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 40 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{detail.leadNo || detail.leadName}</span>
          {statusMeta && (
            <Tag color={statusMeta.color} style={{ marginInlineEnd: 0 }}>
              {t(statusMeta.label)}
            </Tag>
          )}
        </div>
        <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
          {country && <FlagIcon country={country} style={{ width: 20, height: 15, borderRadius: 2 }} />}
          <span>{company}</span>
        </div>
        {product && (
          <div style={{ marginTop: 2, fontSize: 13, color: 'var(--c-text-secondary, #64748b)' }}>{product}</div>
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--c-text-tertiary, #94a3b8)', display: 'flex', gap: 12 }}>
          {detail.quantity ? <span>{t('lead.quantityRequirement')}：{detail.quantity}</span> : null}
          <span>{t('lead.createdAt')}：{detail.createdAt?.slice(0, 10)}</span>
        </div>
      </div>

      <Spin spinning={loading}>
        <div style={{ padding: '4px 16px 0' }}>
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
                        {detail.specialReq || detail.items?.[0]?.productDesc || detail.productDesc || '—'}
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
                key: 'follow',
                label: t('lead.tabFollowUps'),
                children: (
                  <div style={{ paddingBottom: 12 }}>
                    <div className="lead-wizard-summary">
                      <div className="lead-wizard-summary__title">{t('lead.contactMethods')}</div>
                      {contactList.length ? (
                        contactList.map((c, i) => (
                          <div key={i} className="lead-wizard-summary__row">
                            <span className="lead-wizard-summary__label">{c.tool || '—'}</span>
                            <span className="lead-wizard-summary__value">{c.account || '—'}</span>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>—</div>
                      )}
                    </div>
                    <div className="lead-wizard-summary" style={{ marginTop: 12 }}>
                      <div className="lead-wizard-summary__title">{t('lead.remark')}</div>
                      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', whiteSpace: 'pre-wrap' }}>
                        {detail.remark || '—'}
                      </div>
                    </div>
                    <div className="lead-wizard-summary" style={{ marginTop: 12 }}>
                      <div className="lead-wizard-summary__title">{t('lead.status')}</div>
                      <div className="lead-wizard-summary__row">
                        <span className="lead-wizard-summary__label">{t('lead.status')}</span>
                        <span>
                          {statusMeta ? (
                            <Tag color={statusMeta.color} style={{ marginInlineEnd: 0 }}>
                              {t(statusMeta.label)}
                            </Tag>
                          ) : (
                            '—'
                          )}
                        </span>
                      </div>
                      <div className="lead-wizard-summary__row">
                        <span className="lead-wizard-summary__label">{t('lead.createdAt')}</span>
                        <span className="lead-wizard-summary__value">{detail.createdAt?.slice(0, 10) || '—'}</span>
                      </div>
                      <div className="lead-wizard-summary__row">
                        <span className="lead-wizard-summary__label">{t('lead.updatedAt')}</span>
                        <span className="lead-wizard-summary__value">{detail.updatedAt?.slice(0, 10) || '—'}</span>
                      </div>
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Spin>

      <div style={{ padding: '12px 16px', borderTop: '1px dashed rgba(0,0,0,0.08)', display: 'flex', gap: 8 }}>
        {isPool ? (
          <Button type="primary" block onClick={() => onClaim(detail)}>
            {t('lead.claim')}
          </Button>
        ) : (
          <>
            <Button
              type="primary"
              style={{ flex: 1 }}
              disabled={readonly || detail.status === 'CONVERTED'}
              onClick={() => onConvert(detail)}
            >
              {t('lead.confirmLead')}
            </Button>
            <Button onClick={() => onEdit(detail)}>{t('common.edit')}</Button>
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
