import { Button, Space, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { SalesItem } from '../../api/sales';

export const STAGES = [
  { key: 'LEAD', label: '线索', color: '#3b82f6', bg: '#eff6ff' },
  { key: 'OPPORTUNITY', label: '商机', color: '#f59e0b', bg: '#fffbeb' },
  { key: 'SAMPLE', label: '样品单', color: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'ORDER', label: '订单', color: '#10b981', bg: '#ecfdf5' },
];

export const STAGE_LABELS: Record<string, string> = {
  LEAD: '线索', OPPORTUNITY: '商机', SAMPLE: '样品单', ORDER: '订单',
};

interface StageButtonsProps {
  item: SalesItem;
  onStageChange: (id: string, newStage: string) => void;
}

export default function StageButtons({ item, onStageChange }: StageButtonsProps) {
  const idx = STAGES.findIndex((s) => s.key === item.stage);
  return (
    <Space size={4}>
      {idx > 0 && (
        <Tooltip title={`退回到${STAGES[idx - 1].label}`}>
          <Button
            size="small"
            type="text"
            icon={<LeftOutlined />}
            onClick={() => onStageChange(item.id, STAGES[idx - 1].key)}
          />
        </Tooltip>
      )}
      {idx < STAGES.length - 1 && (
        <Tooltip title={`推进到${STAGES[idx + 1].label}`}>
          <Button
            size="small"
            type="text"
            icon={<RightOutlined />}
            onClick={() => onStageChange(item.id, STAGES[idx + 1].key)}
          />
        </Tooltip>
      )}
    </Space>
  );
}
