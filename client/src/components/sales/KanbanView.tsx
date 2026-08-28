import { Badge, Button, Empty, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { SalesItem } from '../../api/sales';
import KanbanCard from './KanbanCard';
import { SALES_STAGES, getStageMeta, getStageI18nKey } from './stages';

interface KanbanViewProps {
  kanbanData: Record<string, { title: string; items: SalesItem[] }>;
  onViewDetail: (id: string) => void;
  /** 新增商机（阶段由后端按关联单据派生，不允许指定） */
  onAdd: () => void;
}

export default function KanbanView({ kanbanData, onViewDetail, onAdd }: KanbanViewProps) {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
      {SALES_STAGES.map((stage) => {
        const meta = getStageMeta(stage);
        const label = t(`sales.stage.${getStageI18nKey(stage)}`);
        const col = kanbanData[stage] || { title: label, items: [] };
        return (
          <div
            key={stage}
            style={{
              flex: '1 1 0', minWidth: 280, maxWidth: 380,
              backgroundColor: meta.bg,
              borderRadius: 12, padding: 12,
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, padding: '0 4px',
            }}>
              <Space>
                <Badge color={meta.color} />
                <span style={{ fontWeight: 600, color: meta.color }}>{col.title || label}</span>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>({col.items.length})</span>
              </Space>
              <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={onAdd}>
                {t('common.add')}
              </Button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', padding: '0 2px' }}>
              {col.items.length === 0 ? (
                <Empty description={t('sales.emptyStage')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                col.items.map((item) => (
                  <KanbanCard
                    key={item.id}
                    item={item}
                    onViewDetail={onViewDetail}
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
