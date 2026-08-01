import { Card, theme } from 'antd';
import { TeamOutlined, DollarOutlined } from '@ant-design/icons';
import { SalesItem } from '../../api/sales';
import { getIntentLabel } from './SalesFormModal';
import StageButtons from './StageButtons';

interface KanbanCardProps {
  item: SalesItem;
  formatCurrency: (value: number) => string;
  onViewDetail: (id: string) => void;
  onStageChange: (id: string, newStage: string) => void;
}

export default function KanbanCard({ item, formatCurrency, onViewDetail, onStageChange }: KanbanCardProps) {
  const { token } = theme.useToken();
  const amount = item.stage === 'ORDER' ? (item.orderAmount || 0) : (item.estimatedAmount || 0);
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
              {formatCurrency(amount)}
            </div>
          )}
          {item.probability && item.stage === 'OPPORTUNITY' && (
            <div style={{ fontSize: 11, color: token.colorWarning, marginTop: 4, fontWeight: 500 }}>{getIntentLabel(item.probability)}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${token.colorBorderSecondary}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
          {item.assignee?.realName || '未分配'}
        </span>
        <StageButtons item={item} onStageChange={onStageChange} />
      </div>
    </Card>
  );
}
