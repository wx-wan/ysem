import { Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
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

/** 动作 → i18n key（`common.logAction.*`）；同义动作（CREATE / CREATED 等）共用一条文案 */
const ACTION_I18N_KEY: Record<string, string> = {
  CREATE: 'create',
  CREATED: 'create',
  UPDATE: 'update',
  UPDATED: 'update',
  DELETE: 'delete',
  STATUS: 'status',
  STAGE: 'stage',
  STAGE_CHANGE: 'stage',
  CLAIM: 'claim',
  RELEASE: 'release',
  TRANSFER: 'transfer',
  TRANSFERRED: 'transfer',
  KEY_TOGGLE: 'keyToggle',
  INTENT_CHANGE: 'intentChange',
  OPPORTUNITY_CREATED: 'opportunityCreated',
  PIPELINE_CREATED: 'opportunityCreated',
  OPPORTUNITY_UPDATED: 'opportunityUpdated',
  PIPELINE_UPDATED: 'opportunityUpdated',
  OPPORTUNITY_DELETED: 'opportunityDeleted',
  PIPELINE_DELETED: 'opportunityDeleted',
  LOGIN: 'login',
  AUTH: 'auth',
  EXPORT: 'export',
  IMPORT: 'import',
};

/**
 * 通用操作记录时间线：从 OperationLog 渲染。
 * 所有业务模块（线索 / 产品 / 客户 / 商机）共用——保证「单一日志库、各模块捞对应记录」口径一致。
 *
 * 文案与线索详情面板的「操作记录」Tab 对齐：
 *   - 动作名走 `common.logAction.*`（不再硬编码中文，否则英文环境会掉回中文）；
 *   - 空态为次要文本（13px，无 Empty 插画）、加载态为「加载中…」。
 */
export default function OperationLogTimeline({ logs, loading }: Props) {
  const { t } = useTranslation();

  if (!loading && logs.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', padding: '12px 0' }}>
        {t('common.logEmpty')}
      </div>
    );
  }

  return (
    <Timeline
      mode="start"
      pending={loading ? t('common.logLoading') : false}
      items={logs.map((log) => {
        const i18nKey = ACTION_I18N_KEY[log.action];
        const label = i18nKey
          ? t(`common.logAction.${i18nKey}`, { defaultValue: LOG_ACTION_LABELS[log.action] || log.action })
          : LOG_ACTION_LABELS[log.action] || log.action;
        const color = LOG_ACTION_COLORS[log.action] || 'blue';
        const operator = log.realName || log.username;
        const diff = parseDiff(log.diff);
        return {
          color,
          content: (
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
