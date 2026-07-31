import { Badge, Button, Empty, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { SalesItem } from '../../api/sales';
import { STAGES } from './StageButtons';
import KanbanCard from './KanbanCard';

interface KanbanViewProps {
  kanbanData: Record<string, { title: string; items: SalesItem[] }>;
  formatCurrency: (value: number) => string;
  onViewDetail: (id: string) => void;
  onStageChange: (id: string, newStage: string) => void;
  onAdd: (stage: string) => void;
}

export default function KanbanView({
  kanbanData, formatCurrency, onViewDetail, onStageChange, onAdd,
}: KanbanViewProps) {
  return (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const col = kanbanData[stage.key] || { title: stage.label, items: [] };
        return (
          <div
            key={stage.key}
            style={{
              flex: '1 1 0', minWidth: 280, maxWidth: 380,
              backgroundColor: stage.bg,
              borderRadius: 12, padding: 12,
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, padding: '0 4px',
            }}>
              <Space>
                <Badge color={stage.color} />
                <span style={{ fontWeight: 600, color: stage.color }}>{col.title}</span>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>({col.items.length})</span>
              </Space>
              <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => onAdd(stage.key)}>
                新增
              </Button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', padding: '0 2px' }}>
              {col.items.length === 0 ? (
                <Empty description={`暂无${col.title}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                col.items.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    formatCurrency={formatCurrency}
                    onViewDetail={onViewDetail}
                    onStageChange={onStageChange}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
