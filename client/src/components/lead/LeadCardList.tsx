import { Empty, Spin, Tag } from 'antd';
import { RightCircleOutlined, UpCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import FlagIcon from '../FlagIcon';
import { type Lead } from '../../api/lead';
import { STATUS_META } from './constants';

/** 头像底色（按 seed 稳定取色，同一负责人颜色不变） */
export const leadAvatarColor = (seed?: string | null) => {
  const palette = ['#1677ff', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];
  if (!seed) return palette[0];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return palette[h % palette.length];
};

interface Props {
  dataSource: Lead[];
  loading: boolean;
  selectedId?: string | null;
  onSelect: (record: Lead) => void;
}

/**
 * 线索卡片列表（替代表格交互）：点击卡片选中，右侧联动显示详情面板。
 * 卡片信息：负责人头像 / 线索号 + 状态标签 / 国旗 + 客户公司 / 产品 / 数量与需求摘要 / 日期 / 负责人。
 */
export default function LeadCardList({ dataSource, loading, selectedId, onSelect }: Props) {
  const { t } = useTranslation();

  return (
    <Spin spinning={loading}>
      <div className="lead-card-list">
        {dataSource.map((r) => {
          const ownerName = r.owner?.realName || r.owner?.username || '';
          const ownerSeed = r.ownerId || r.id;
          const company = r.customer?.companyName || r.companyName || '-';
          const country = r.targetMarket || r.country || '';
          const product = r.items?.[0]?.productName || r.productName || r.productInterest || '';
          const desc = r.items?.[0]?.productDesc || r.productDesc || '';
          const statusMeta = STATUS_META[r.status];
          // 左侧大头像代表客户公司：取公司名首字，同一公司颜色稳定
          const companyInitial = company !== '-' ? company[0] : '?';
          const companySeed = company !== '-' ? company : r.id;
          return (
            <div
              key={r.id}
              className={`lead-card${selectedId === r.id ? ' is-active' : ''}`}
              onClick={() => onSelect(r)}
            >
              <span className="lead-card__avatar" style={{ background: leadAvatarColor(companySeed) }}>
                {companyInitial}
              </span>
              <div className="lead-card__main">
                <div className="lead-card__no-row">
                  <span className="lead-card__no">{r.leadNo || r.leadName}</span>
                  {statusMeta && <Tag color={statusMeta.color} className="lead-card__tag">{t(statusMeta.label)}</Tag>}
                  {r.customerType && <Tag className="lead-card__tag">{r.customerType}</Tag>}
                </div>
                <div className="lead-card__company">
                  {country && <FlagIcon country={country} style={{ width: 20, height: 15, borderRadius: 2 }} />}
                  <span className="lead-card__company-name">{company}</span>
                </div>
                {product && <div className="lead-card__prod">{product}</div>}
                {(r.quantity || desc) && (
                  <div className="lead-card__meta">
                    {r.quantity ? <span>{t('lead.quantityRequirement')}：{r.quantity}{r.unit || '个'}</span> : null}
                    {desc && <span className="lead-card__desc">{desc}</span>}
                  </div>
                )}
              </div>
              <div className="lead-card__side">
                <div className="lead-card__date">{r.createdAt?.slice(0, 10)}</div>
                {ownerName && (
                  <div className="lead-card__owner">
                    <span className="lead-card__owner-avatar" style={{ background: leadAvatarColor(ownerSeed) }}>
                      {ownerName[0]}
                    </span>
                    <span>{ownerName}</span>
                  </div>
                )}
                {/* 展开态：「收起」+ UpCircleOutlined；收起态：「查看详情」+ RightCircleOutlined。
                    描边图标继承文字颜色（currentColor），文字与图标样式统一为主题色 */}
                <span className="lead-card__more">
                  {selectedId === r.id ? (
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
