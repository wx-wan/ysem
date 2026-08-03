import { useMemo } from 'react';
import { Tag } from 'antd';
import { tagColorToHex } from '../shared/utils';

// ── 解析 & 过滤工具 ──
function parseTag(tagStr: string): { name: string; color?: string } {
  const idx = tagStr.lastIndexOf('#');
  if (idx > 0) {
    return { name: tagStr.slice(0, idx), color: tagStr.slice(idx + 1) };
  }
  return { name: tagStr };
}

const SYSTEM_TAGS = ['重点客户', '未成交客户', '本年度新客', '往年老客'];

/**
 * 解析 tags 字符串，过滤掉系统标签，只返回自定义标签
 */
export function filterCustomTags(tags?: string): { name: string; color?: string }[] {
  if (!tags) return [];
  return tags
    .split(',')
    .filter(Boolean)
    .map(parseTag)
    .filter((t) => !SYSTEM_TAGS.includes(t.name));
}

/**
 * 解析 tags 字符串，返回所有标签（不过滤系统标签）
 */
export function parseAllTags(tags?: string): { name: string; color?: string }[] {
  if (!tags) return [];
  return tags.split(',').filter(Boolean).map(parseTag);
}

interface CustomerTagsProps {
  tags?: string;
  token: any;
  /** 'default' - 白色背景卡片中使用 | 'overlay' - 渐变背景中使用 */
  variant?: 'default' | 'overlay';
}

/**
 * 统一的客户标签展示组件
 * - 默认只展示自定义标签（过滤系统标签）
 * - 支持 default / overlay 两种视觉变体
 */
export default function CustomerTags({ tags, token, variant = 'default' }: CustomerTagsProps) {
  const customTags = useMemo(() => filterCustomTags(tags), [tags]);

  if (customTags.length === 0) return null;

  const isOverlay = variant === 'overlay';

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {customTags.map((tag) => {
        const c = tagColorToHex(tag.color, token);
        return (
          <Tag
            key={tag.name}
            bordered={false}
            style={{
              margin: 0,
              borderRadius: token.borderRadiusSM,
              fontSize: 11,
              padding: '1px 8px',
              background: isOverlay ? 'rgba(255,255,255,0.15)' : token.colorBgContainer,
              color: isOverlay ? '#fff' : c,
              border: `1px solid ${isOverlay ? 'rgba(255,255,255,0.3)' : c}`,
            }}
          >
            {tag.name}
          </Tag>
        );
      })}
    </div>
  );
}
