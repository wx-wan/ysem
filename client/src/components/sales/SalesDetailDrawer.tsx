import React from 'react';
import { Drawer, Descriptions, Tag, Space, Button, Popconfirm, Card, Alert } from 'antd';
import { EditOutlined, DeleteOutlined, RightOutlined, AppstoreOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SalesItem } from '../../api/sales';
import { Z_INDEX } from '../../zIndex';
import { getIntentLabel } from './SalesFormModal';
import { getStageMeta, getStageI18nKey, type SalesStage } from './stages';
import Price from '../common/Price';
import QuotationSection from './QuotationSection';

/** 活动动作 → i18n key 后缀 */
const SALES_ACTIVITY_ACTION: Record<string, string> = {
  CREATE: 'created',
  CREATED: 'created',
  UPDATE: 'updated',
  UPDATED: 'updated',
  DELETE: 'deleted',
  PIPELINE_CREATED: 'pipelineCreated',
  PIPELINE_UPDATED: 'pipelineUpdated',
  PIPELINE_DELETED: 'pipelineDeleted',
};

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
      {/* 溯源：来源线索 */}
      {detailItem.leadId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={
            <Space>
              <span>
                {t('sales.sourceLead')}：<b>{detailItem.leadId}</b>
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

      {detailItem.activities && detailItem.activities.length > 0 && (
        <Card title={t('sales.activities')} size="small" style={{ marginTop: 16 }}>
          {detailItem.activities.map((a) => (
            <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <Tag color="blue" style={{ marginRight: 8 }}>
                {SALES_ACTIVITY_ACTION[a.action] ? t(`sales.activity.${SALES_ACTIVITY_ACTION[a.action]}`) : a.action}
              </Tag>
              {a.fromStage && (
                <span>
                  {t(`sales.stage.${getStageI18nKey(a.fromStage)}`)} <RightOutlined /> {t(`sales.stage.${getStageI18nKey(a.toStage ?? '')}`)}
                </span>
              )}
              <span style={{ marginLeft: 12, color: '#94a3b8', fontSize: 11 }}>{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </Card>
      )}

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
