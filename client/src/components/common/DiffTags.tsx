import React from 'react';
import { Tag, Tooltip, Image } from 'antd';
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

  const thumb = (url: string, dim: boolean, name?: string) => (
    <Image
      src={url}
      alt={name || ''}
      width={20}
      height={20}
      preview={{
        imageRender: (node) => (
          <>
            {node}
            {name ? <div className="pil-preview-name">{name}</div> : null}
          </>
        ),
      }}
      style={{
        width: 20,
        height: 20,
        objectFit: 'cover',
        borderRadius: 3,
        marginRight: 2,
        border: dim ? '1px solid #d9d9d9' : '1px solid #1677ff',
        filter: dim ? 'grayscale(1) opacity(0.55)' : 'none',
        verticalAlign: 'middle',
        cursor: 'pointer',
      }}
    />
  );

  const renderImages = (it: DiffItem) => {
    const beforeArr: { url: string; name?: string }[] = Array.isArray(it.before) ? it.before : [];
    const afterArr: { url: string; name?: string }[] = Array.isArray(it.after) ? it.after : [];
    const nameChanged =
      beforeArr.length === afterArr.length &&
      beforeArr.some((b, idx) => b.name && afterArr[idx]?.name && b.name !== afterArr[idx].name);

    return (
      <Tag
        key={it.field}
        style={{
          margin: 0,
          padding: '2px 8px',
          borderRadius: 8,
          background: '#f5f7fa',
          border: '1px solid #e8eaed',
          fontSize: 12,
        }}
      >
        <span style={{ color: '#8c8c8c' }}>{it.label}：</span>
        <span style={{ marginRight: 4, display: 'inline-flex', alignItems: 'center' }}>
          {beforeArr.length ? beforeArr.map((b) => <span key={b.url}>{thumb(b.url, true, b.name)}</span>) : <span style={{ textDecoration: 'line-through', color: '#bfbfbf' }}>空</span>}
        </span>
        <ArrowRightOutlined style={{ fontSize: 10, color: '#d9d9d9', marginRight: 4 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
          {afterArr.length ? afterArr.map((a) => <span key={a.url}>{thumb(a.url, false, a.name)}</span>) : <span style={{ color: '#1677ff', fontWeight: 600 }}>空</span>}
        </span>
        {nameChanged && (
          <span style={{ marginLeft: 6, color: '#fa8c16' }}>
            名称：{beforeArr.map((b) => b.name).join('、')} → {afterArr.map((a) => a.name).join('、')}
          </span>
        )}
      </Tag>
    );
  };

  return (
    <div style={{ display: 'flex', flexWrap: wrap ? 'wrap' : 'nowrap', gap: 6, marginTop: 6 }}>
      {shown.map((it, i) =>
        it.field === 'images' ? renderImages(it) : (
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
