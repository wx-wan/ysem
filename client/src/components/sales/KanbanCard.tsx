import { Card, theme, Tag } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { SalesItem } from '../../api/sales';
import { getIntentLabel } from './SalesFormModal';
import { getStageMeta, getStageI18nKey } from './stages';
import Price from '../common/Price';

interface KanbanCardProps {
  item: SalesItem;
  onViewDetail: (id: string) => void;
}

export default function KanbanCard({ item, onViewDetail }: KanbanCardProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const amount = item.stage === 'ORDER' || item.stage === 'SHIPPED'
    ? (item.orderAmount || 0)
    : (item.estimatedAmount || 0);
  return (
    <Card
      hoverable
      size="small"
      style={{ marginBottom: 10, borderRadius: 8 }}
      onClick={() => onViewDetail(item.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: token.colorText, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </div>
          <div style={{ color: token.colorTextSecondary, fontSize: 12, marginBottom: 2 }}>
            <TeamOutlined style={{ marginRight: 4 }} />
            {item.companyName}
          </div>
          {item.contactName && (
            <div style={{ color: token.colorTextTertiary, fontSize: 12 }}>{item.contactName}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {(item.estimatedAmount || item.orderAmount) && (
            <div style={{ fontWeight: 700, color: token.colorText, fontSize: 15, whiteSpace: 'nowrap', letterSpacing: '-0.2px' }}>
              <Price value={amount} />
            </div>
          )}
          {item.probability && item.stage === 'OPPORTUNITY' && (
            <div style={{ fontSize: 11, color: token.colorWarning, marginTop: 4, fontWeight: 500 }}>{getIntentLabel(item.probability)}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
          {item.assignee?.realName || t('sales.unassigned')}
        </span>
        {/* 阶段只读展示：由后端按关联单据派生，不支持手动切换 */}
        <Tag color={getStageMeta(item.stage).color} variant="filled" style={{ marginInlineEnd: 0 }}>
          {t(`sales.stage.${getStageI18nKey(item.stage)}`)}
        </Tag>
      </div>
    </Card>
  );
}
