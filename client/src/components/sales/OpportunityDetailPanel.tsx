import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Empty, Popconfirm, Tabs, Tag } from 'antd';
import {
  AppstoreOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getSalesLogs, type OpLog } from '../../api/operationLog';
import OperationLogTimeline from '../common/OperationLogTimeline';
import { getStageMeta, getStageI18nKey } from './stages';
import { getIntentLabel } from './SalesFormModal';
import FlagIcon from '../FlagIcon';
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

export default function OpportunityDetailPanel({ detail, loading, isAdmin, onClose, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [logs, setLogs] = useState<OpLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadLogs = useCallback(async () => {
    if (!detail?.id) return;
    setLogsLoading(true);
    try {
      const res = await getSalesLogs(detail.id);
      setLogs(res.data.data || []);
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
      <div className="lead-detail-panel lead-detail-panel--empty">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('lead.noSelection')} />
      </div>
    );
  }

  const meta = getStageMeta(detail.stage);
  const company = detail.customer?.companyName || detail.companyName || '-';
  const country = detail.country || '';
  const ownerName = detail.assignee?.realName || detail.assignee?.username || '';
  const channelText = detail.channel?.name
    ? `${detail.channel.name}${detail.shop?.name ? ` / ${detail.shop.name}` : ''}`
    : '-';

  const stageSection = (() => {
    if (detail.stage === 'OPPORTUNITY' || detail.stage === 'QUOTED') {
      return (
        <div className="lead-wizard-summary" style={{ marginTop: 16 }}>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.estAmount')}</span>
            <span className="lead-wizard-summary__value">
              {detail.estimatedAmount ? <Price value={detail.estimatedAmount} /> : '-'}
            </span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.probability')}</span>
            <span className="lead-wizard-summary__value">{getIntentLabel(detail.probability)}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.estCloseDate')}</span>
            <span className="lead-wizard-summary__value">{detail.estimatedCloseDate || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.opportunityNotes')}</span>
            <span className="lead-wizard-summary__value">{detail.opportunityNotes || '-'}</span>
          </div>
        </div>
      );
    }
    if (detail.stage === 'SAMPLE') {
      return (
        <div className="lead-wizard-summary" style={{ marginTop: 16 }}>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.sampleType')}</span>
            <span className="lead-wizard-summary__value">{detail.sampleType || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.sampleQuantity')}</span>
            <span className="lead-wizard-summary__value">{detail.sampleQuantity ?? '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.sampleStatus')}</span>
            <span className="lead-wizard-summary__value">{detail.sampleStatus || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.sampleNotes')}</span>
            <span className="lead-wizard-summary__value">{detail.sampleNotes || '-'}</span>
          </div>
        </div>
      );
    }
    if (detail.stage === 'ORDER') {
      return (
        <div className="lead-wizard-summary" style={{ marginTop: 16 }}>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.orderType')}</span>
            <span className="lead-wizard-summary__value">{detail.orderType || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.orderAmount')}</span>
            <span className="lead-wizard-summary__value">
              {detail.orderAmount ? <Price value={detail.orderAmount} /> : '-'}
            </span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.orderDate')}</span>
            <span className="lead-wizard-summary__value">{detail.orderDate || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.deliveryDate')}</span>
            <span className="lead-wizard-summary__value">{detail.deliveryDate || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.paymentTerms')}</span>
            <span className="lead-wizard-summary__value">{detail.paymentTerms || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.orderStatus')}</span>
            <span className="lead-wizard-summary__value">{detail.orderStatus || '-'}</span>
          </div>
          <div className="lead-wizard-summary__row">
            <span className="lead-wizard-summary__label">{t('sales.orderNotes')}</span>
            <span className="lead-wizard-summary__value">{detail.orderNotes || '-'}</span>
          </div>
        </div>
      );
    }
    return null;
  })();

  const products = detail.leadProducts || [];

  const infoTab = (
    <div>
      {detail.leadId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <span>
              {t('sales.sourceLead')}：<b>{detail.lead?.leadNo || detail.leadId}</b>
              {detail.lead?.leadName ? `（${detail.lead.leadName}）` : ''}
            </span>
          }
        />
      )}
      <div className="lead-wizard-summary">
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.title_field')}</span>
          <span className="lead-wizard-summary__value">{detail.title || '-'}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.stage.label')}</span>
          <span className="lead-wizard-summary__value">
            {meta && (
              <Tag color={meta.color} variant="filled">
                {t(`sales.stage.${getStageI18nKey(detail.stage)}`)}
              </Tag>
            )}
          </span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.companyName')}</span>
          <span className="lead-wizard-summary__value">{company}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.contact')}</span>
          <span className="lead-wizard-summary__value">{detail.contactName || '-'}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.email')}</span>
          <span className="lead-wizard-summary__value">{detail.email || '-'}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.phone')}</span>
          <span className="lead-wizard-summary__value">{detail.phone || '-'}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.country')}</span>
          <span className="lead-wizard-summary__value">
            {country ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <FlagIcon country={country} style={{ width: 20, height: 15, borderRadius: 2 }} />
                {country}
              </span>
            ) : (
              '-'
            )}
          </span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.source.label')}</span>
          <span className="lead-wizard-summary__value">{detail.source || '-'}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.sourceChannel')}</span>
          <span className="lead-wizard-summary__value">{channelText}</span>
        </div>
        <div className="lead-wizard-summary__row">
          <span className="lead-wizard-summary__label">{t('sales.owner')}</span>
          <span className="lead-wizard-summary__value">
            {ownerName || t('sales.unassigned')}
          </span>
        </div>
      </div>

      {/* 关联产品 */}
      <div style={{ marginTop: 16 }}>
        <div className="lead-wizard-summary__label" style={{ marginBottom: 8 }}>
          {t('sales.relatedProducts')}
          {products.length > 0 && <Tag style={{ marginLeft: 6 }}>{products.length}</Tag>}
        </div>
        {products.length === 0 ? (
          <span style={{ color: '#94a3b8' }}>{t('sales.noProducts')}</span>
        ) : (
          products.map((lp) => (
            <div
              key={lp.id}
              style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}
            >
              <span>{lp.product?.name || lp.productId}</span>
              <span style={{ color: '#64748b' }}>×{lp.quantity ?? 1}</span>
            </div>
          ))
        )}
      </div>

      {stageSection}
    </div>
  );

  return (
    <div className="lead-detail-panel">
      <div className="lead-detail-panel__header">
        <div>
          <div className="lead-detail-panel__title">{detail.opportunityNo || detail.title}</div>
          <div className="lead-detail-panel__sub">
            {meta && (
              <Tag color={meta.color} variant="filled">
                {t(`sales.stage.${getStageI18nKey(detail.stage)}`)}
              </Tag>
            )}
            <span>{company}</span>
            {country && <FlagIcon country={country} style={{ width: 20, height: 15, borderRadius: 2 }} />}
          </div>
        </div>
        <Button type="text" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      <div className="lead-detail-panel__body">
        <Tabs
          items={[
            { key: 'info', label: t('common.tabBasic'), children: infoTab },
            {
              key: 'logs',
              label: t('common.tabLogs'),
              children: <OperationLogTimeline logs={logs} loading={logsLoading} />,
            },
          ]}
        />
      </div>

      <div className="lead-detail-panel__actions">
        <Button block onClick={() => onEdit(detail)}>
          {t('common.edit')}
        </Button>
        {isAdmin && (
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => onDelete(detail)}>
            <Button block danger>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        )}
      </div>
    </div>
  );
}
