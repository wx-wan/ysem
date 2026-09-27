import { Empty, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import DiffTags from './DiffTags';
import {
  type OperationLogItem,
  LOG_ACTION_LABELS,
  LOG_ACTION_COLORS,
} from '../../api/operationLog';

const { Text, Paragraph } = Typography;

interface Props {
  logs: OperationLogItem[];
  loading?: boolean;
}

/** 解析日志 diff JSON（[{field,label,beforeText,afterText}]） */
const parseDiff = (raw?: string | null): any[] => {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
};

/**
 * 通用操作记录时间线：从 OperationLog 渲染。
 * 所有业务模块（线索 / 产品 / 客户 / 商机）共用——保证「单一日志库、各模块捞对应记录」口径一致。
 */
export default function OperationLogTimeline({ logs, loading }: Props) {
  if (!loading && logs.length === 0) {
    return <Empty description="暂无操作记录" style={{ padding: '48px 0' }} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Timeline
      mode="left"
      pending={loading ? '加载中…' : false}
      items={logs.map((log) => {
        const label = LOG_ACTION_LABELS[log.action] || log.action;
        const color = LOG_ACTION_COLORS[log.action] || 'blue';
        const operator = log.realName || log.username;
        const diff = parseDiff(log.diff);
        return {
          color,
          children: (
            <div key={log.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <Text strong>{label}</Text>
                {log.businessNo && (
                  <Text type="secondary" style={{ fontSize: 12 }}>#{log.businessNo}</Text>
                )}
              </div>
              {log.summary && (
                <Paragraph style={{ margin: '4px 0' }}>{log.summary}</Paragraph>
              )}
              {diff.length > 0 && <DiffTags diff={diff} max={6} />}
              <div style={{ marginTop: 4, color: '#8c8c8c', fontSize: 12 }}>
                {operator}
                {log.createdAt ? ` · ${dayjs(log.createdAt).format('YYYY-MM-DD HH:mm')}` : ''}
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
