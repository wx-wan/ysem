import { Card } from 'antd';
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
  return (
    <Card
      hoverable
      size="small"
      style={{ marginBottom: 10, borderRadius: 8 }}
      onClick={() => onViewDetail(item.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>
            <TeamOutlined style={{ marginRight: 4 }} />
            {item.companyName}
          </div>
          {item.contactName && (
            <div style={{ color: '#94a3b8', fontSize: 12 }}>{item.contactName}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {(item.estimatedAmount || item.orderAmount) && (
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13, whiteSpace: 'nowrap' }}>
              <DollarOutlined style={{ fontSize: 11 }} />{' '}
              {formatCurrency(item.stage === 'ORDER' ? (item.orderAmount || 0) : (item.estimatedAmount || 0))}
            </div>
          )}
          {item.probability && item.stage === 'OPPORTUNITY' && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{getIntentLabel(item.probability)}</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {item.assignee?.realName || '未分配'}
        </span>
        <StageButtons item={item} onStageChange={onStageChange} />
      </div>
    </Card>
  );
}
