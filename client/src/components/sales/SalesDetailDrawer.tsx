import React from 'react';
import { Drawer, Descriptions, Tag, Space, Button, Popconfirm, Card, Alert } from 'antd';
import { EditOutlined, DeleteOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SalesItem } from '../../api/sales';
import { Z_INDEX } from '../../zIndex';
import { getIntentLabel } from './SalesFormModal';
import { getStageMeta, getStageI18nKey, type SalesStage } from './stages';
import Price from '../common/Price';
import QuotationSection from './QuotationSection';
import { getSalesLogs, type OperationLogItem } from '../../api/operationLog';
import OperationLogTimeline from '../common/OperationLogTimeline';
import { useEffect, useState } from 'react';

interface Props {
  open: boolean;
  detailItem: SalesItem | null;
  onClose: () => void;
  onEdit: (item: SalesItem) => void;
  onDelete: (id: string) => void;
}

const SalesDetailDrawer: React.FC<Props> = React.memo(({ open, detailItem, onClose, onEdit, onDelete }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  if (!detailItem) return null;
  const meta = getStageMeta(detailItem.stage);

  const products = detailItem.leadProducts ?? [];

  // 活动记录：从 OperationLog 按 businessType=OPPORTUNITY 捞取（单一日志库，不读已删除的 OpportunityActivity 副表）
  const [logs, setLogs] = useState<OperationLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  useEffect(() => {
    if (!open || !detailItem?.id) {
      setLogs([]);
      return;
    }
    let cancelled = false;
    setLogsLoading(true);
    getSalesLogs(detailItem.id)
      .then((list) => { if (!cancelled) setLogs(list); })
      .catch(() => { if (!cancelled) setLogs([]); })
      .finally(() => { if (!cancelled) setLogsLoading(false); });
    return () => { cancelled = true; };
  }, [open, detailItem?.id]);

  return (
    <Drawer
      title={t('sales.detailTitle')}
      open={open}
      onClose={onClose}
      size={560}
      zIndex={Z_INDEX.overlay}
      extra={
        <Space>
          {/* 阶段只读：由后端按关联单据派生，不支持手动切换 */}
          <Tag color={meta.color} variant="filled">{t(`sales.stage.${getStageI18nKey(detailItem.stage)}`)}</Tag>
          <Button icon={<EditOutlined />} onClick={() => { onClose(); onEdit(detailItem); }}>{t('common.edit')}</Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => { onDelete(detailItem.id); onClose(); }}>
            <Button danger icon={<DeleteOutlined />}>{t('common.delete')}</Button>
          </Popconfirm>
        </Space>
      }
    >
      {/* 溯源：来源线索（优先展示线索号，无线索号时回退为 ID） */}
      {detailItem.leadId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <span>
                {t('sales.sourceLead')}：<b>{detailItem.lead?.leadNo || detailItem.leadId}</b>
                {detailItem.lead?.leadName ? `（${detailItem.lead.leadName}）` : ''}
              </span>
              <Button type="link" size="small" onClick={() => navigate('/sales/leads')}>
                {t('sales.viewLead')}
              </Button>
            </Space>
          }
        />
      )}

      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('sales.title_field')}>{detailItem.title}</Descriptions.Item>
        <Descriptions.Item label={t('sales.stage.label')}>
          <Tag color={meta.color} style={{ background: meta.bg, borderColor: meta.border }} variant="filled">
            {t(`sales.stage.${getStageI18nKey(detailItem.stage)}`)}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t('sales.companyName')}>{detailItem.companyName}</Descriptions.Item>
        <Descriptions.Item label={t('sales.contact')}>{detailItem.contactName || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('sales.email')}>{detailItem.email || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('sales.phone')}>{detailItem.phone || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('sales.country')}>{detailItem.country || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('sales.source.label')}>{detailItem.source || '-'}</Descriptions.Item>
        <Descriptions.Item label={t('sales.owner')}>{detailItem.assignee?.realName || t('sales.unassigned')}</Descriptions.Item>
      </Descriptions>

      {/* 关联产品（真实 leadProducts 关联，而非文本字段） */}
      <Card
        size="small"
        style={{ marginTop: 16 }}
        title={
          <Space>
            <AppstoreOutlined />
            {t('sales.relatedProducts')}
            <Tag>{products.length}</Tag>
          </Space>
        }
      >
        {products.length === 0 ? (
          <span style={{ color: '#94a3b8' }}>{t('sales.noProducts')}</span>
        ) : (
          products.map((lp) => (
            <div key={lp.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span>{lp.product?.name || lp.productId}</span>
              <span style={{ color: '#64748b' }}>×{lp.quantity ?? 1}</span>
            </div>
          ))
        )}
      </Card>

      {(detailItem.stage === 'OPPORTUNITY' || detailItem.stage === 'QUOTED') && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label={t('sales.estAmount')}>{detailItem.estimatedAmount ? <Price value={detailItem.estimatedAmount} /> : '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.probability')}>{getIntentLabel(detailItem.probability)}</Descriptions.Item>
          <Descriptions.Item label={t('sales.estCloseDate')}>{detailItem.estimatedCloseDate || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.opportunityNotes')}>{detailItem.opportunityNotes || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      {detailItem.stage === 'SAMPLE' && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label={t('sales.sampleType')}>{detailItem.sampleType || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.sampleQuantity')}>{detailItem.sampleQuantity ?? '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.sampleStatus')}>{detailItem.sampleStatus || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.sampleNotes')}>{detailItem.sampleNotes || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      {detailItem.stage === 'ORDER' && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label={t('sales.orderType')}>{detailItem.orderType || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.orderAmount')}>{detailItem.orderAmount ? <Price value={detailItem.orderAmount} /> : '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.orderDate')}>{detailItem.orderDate || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.deliveryDate')}>{detailItem.deliveryDate || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.paymentTerms')}>{detailItem.paymentTerms || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.orderStatus')}>{detailItem.orderStatus || '-'}</Descriptions.Item>
          <Descriptions.Item label={t('sales.orderNotes')}>{detailItem.orderNotes || '-'}</Descriptions.Item>
        </Descriptions>
      )}

      <Card title={t('sales.activities')} size="small" style={{ marginTop: 16 }}>
        <OperationLogTimeline logs={logs} loading={logsLoading} />
      </Card>

      {/* 报价段：仅当关联了产品时显示，支持多产品 */}
      {products.length > 0 && (
        <QuotationSection opportunityId={detailItem.id} productId={products[0]?.productId} />
      )}

      <div style={{ marginTop: 16 }}>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          {t('sales.createdAt')} {new Date(detailItem.createdAt).toLocaleString('zh-CN')} | {t('sales.updatedAt')} {new Date(detailItem.updatedAt).toLocaleString('zh-CN')}
        </span>
      </div>
    </Drawer>
  );
});

export default SalesDetailDrawer;
