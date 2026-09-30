import { Empty, Spin, Tag } from 'antd';
import { RightCircleOutlined, UpCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { leadAvatarColor } from '../lead/LeadCardList';
import { getStageMeta, getStageI18nKey } from './stages';
import Price from '../common/Price';
import type { SalesItem } from '../../api/sales';

interface Props {
  dataSource: SalesItem[];
  loading: boolean;
  selectedId?: string | null;
  onSelect: (record: SalesItem) => void;
}

export default function OpportunityCardList({ dataSource, loading, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <Spin spinning={loading}>
      <div className="lead-card-list">
        {dataSource.map((r) => {
          // 后端契约：负责人取 owner.*，公司名取 customer.companyName（无顶层 companyName / assignee）
          const ownerName = r.owner?.realName || r.owner?.username || '';
          const ownerSeed = r.ownerId || r.id;
          const company = r.customer?.companyName || '-';
          const product = r.items?.[0]?.productName || r.items?.[0]?.product?.name || '';
          const stage = r.stage ?? '';
          const stageMeta = getStageMeta(stage);
          const amount = Number(r.estimatedAmount || 0);
          const companyInitial = company !== '-' ? company[0] : '?';
          const companySeed = company !== '-' ? company : r.id;
          const isActive = selectedId === r.id;
          return (
            <div
              key={r.id}
              className={`lead-card${isActive ? ' is-active' : ''}`}
              onClick={() => onSelect(r)}
            >
              <span className="lead-card__avatar" style={{ background: leadAvatarColor(companySeed) }}>
                {companyInitial}
              </span>
              <div className="lead-card__main">
                <div className="lead-card__no-row">
                  <span className="lead-card__no">{r.opportunityNo || r.title}</span>
                  {stageMeta && (
                    <Tag color={stageMeta.color} icon={stageMeta.icon} className="lead-card__tag">
                      {t(`sales.stage.${getStageI18nKey(stage)}`)}
                    </Tag>
                  )}
                </div>
                <div className="lead-card__company">
                  <span className="lead-card__company-name">{company}</span>
                </div>
                {product && <div className="lead-card__prod">{product}</div>}
                <div className="lead-card__meta">
                  {amount !== 0 ? (
                    <span>
                      {t('sales.estAmount')}：<Price value={amount} />
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="lead-card__side">
                <div className="lead-card__date">{(r.createdAt || '').slice(0, 10)}</div>
                {ownerName && (
                  <div className="lead-card__owner">
                    <span className="lead-card__owner-avatar" style={{ background: leadAvatarColor(ownerSeed) }}>
                      {ownerName[0]}
                    </span>
                    <span>{ownerName}</span>
                  </div>
                )}
                <span className="lead-card__more">
                  {isActive ? (
                    <>
                      {t('lead.collapseDetail')} <UpCircleOutlined />
                    </>
                  ) : (
                    <>
                      {t('lead.viewDetail')} <RightCircleOutlined />
                    </>
                  )}
                </span>
              </div>
            </div>
          );
        })}
        {!dataSource.length && !loading && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ padding: '40px 0' }} />
        )}
      </div>
    </Spin>
  );
}
