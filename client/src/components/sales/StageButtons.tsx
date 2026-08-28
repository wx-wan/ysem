import { Button, Space, Tooltip } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import { SalesItem } from '../../api/sales';
import { SALES_STAGES, STAGE_META } from './stages';

export const STAGES = SALES_STAGES.map((key) => ({ key, label: STAGE_META[key].label, color: STAGE_META[key].color, bg: STAGE_META[key].bg }));

export const STAGE_LABELS: Record<string, string> = SALES_STAGES.reduce(
  (acc, s) => ({ ...acc, [s]: STAGE_META[s].label }),
  {} as Record<string, string>,
);

interface StageButtonsProps {
  item: SalesItem;
  onStageChange: (id: string, newStage: string) => void;
}

export default function StageButtons({ item, onStageChange }: StageButtonsProps) {
  const idx = SALES_STAGES.indexOf(item.stage as any);
  if (idx < 0) return null;
  return (
    <Space size={4}>
      {idx > 0 && (
        <Tooltip title={`退回到${STAGE_META[SALES_STAGES[idx - 1]].label}`}>
          <Button
            size="small"
            type="text"
            icon={<LeftOutlined />}
            onClick={() => onStageChange(item.id, SALES_STAGES[idx - 1])}
          />
        </Tooltip>
      )}
      {idx < SALES_STAGES.length - 1 && (
        <Tooltip title={`推进到${STAGE_META[SALES_STAGES[idx + 1]].label}`}>
          <Button
            size="small"
            type="text"
            icon={<RightOutlined />}
            onClick={() => onStageChange(item.id, SALES_STAGES[idx + 1])}
          />
        </Tooltip>
      )}
    </Space>
  );
}
