import React from 'react';
import { Tag, Tooltip } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';

export interface DiffItem {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
  beforeText: string;
  afterText: string;
}

export function parseDiff(raw: string | DiffItem[] | null | undefined): DiffItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as DiffItem[];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as DiffItem[]) : [];
  } catch {
    return [];
  }
}

interface DiffTagsProps {
  diff?: string | DiffItem[] | null;
  /** 最多展示几条，超出折叠 */
  max?: number;
  wrap?: boolean;
}

/**
 * 以 Tag 形式展示字段变更：字段名 + 旧值（删除线）+ 箭头 + 新值。
 * 全系统操作日志统一复用此组件。
 */
const DiffTags: React.FC<DiffTagsProps> = ({ diff, max, wrap = true }) => {
  const items = parseDiff(diff);
  if (!items.length) return null;

  const shown = max ? items.slice(0, max) : items;
  const rest = max ? items.slice(max) : [];

  return (
    <div style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 6, marginTop: 6 }}>
      {shown.map((it, i) => (
        <Tooltip key={i} title={`${it.label}：${it.beforeText} → ${it.afterText}`}>
          <Tag
            style={{
              margin: 0,
              padding: '1px 8px',
              borderRadius: 8,
              background: '#f5f7fa',
              border: '1px solid #e8eaed',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#8c8c8c' }}>{it.label}：</span>
            <span
              style={{
                textDecoration: 'line-through',
                color: '#bfbfbf',
                marginRight: 4,
              }}
            >
              {it.beforeText}
            </span>
            <ArrowRightOutlined style={{ fontSize: 10, color: '#d9d9d9', marginRight: 4 }} />
            <span style={{ color: '#1677ff', fontWeight: 600 }}>{it.afterText}</span>
          </Tag>
        </Tooltip>
      ))}
      {rest.length > 0 && (
        <Tooltip title={rest.map((r) => `${r.label}：${r.beforeText} → ${r.afterText}`).join('\n')}>
          <Tag style={{ margin: 0, borderRadius: 8 }}>+{rest.length}</Tag>
        </Tooltip>
      )}
    </div>
  );
};

export default DiffTags;
