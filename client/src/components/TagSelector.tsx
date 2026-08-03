import { useState, useCallback, useRef } from 'react';
import { Tag, Input, theme } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

function parseTag(tagStr: string): { name: string } {
  const idx = tagStr.lastIndexOf('#');
  return { name: idx > 0 ? tagStr.slice(0, idx) : tagStr };
}

function tagsToArray(tags?: string): { name: string }[] {
  if (!tags) return [];
  return tags.split(',').filter(Boolean).map(parseTag);
}

function tagsArrayToString(tags: { name: string }[]): string {
  return tags.map((t) => t.name).join(',');
}

export interface TagSelectorProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  showAddButton?: boolean;
  /** 主题色（十六进制，如 #1677ff），标签实色背景；不传回退主蓝 */
  color?: string;
  /** 透传外层容器样式（仅在需要时传入，避免影响默认卡片样式） */
  style?: React.CSSProperties;
  /** 最多可添加的标签数量，默认 5；达到上限后禁用添加按钮 */
  maxCount?: number;
}

export default function TagSelector({ value, onChange, placeholder = '输入标签名称', showAddButton = true, color, style, maxCount = 5 }: TagSelectorProps) {
  const { token } = theme.useToken();
  const themeColor = color || token.colorPrimary;
  const tags = tagsToArray(value);
  const [inputVisible, setInputVisible] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const composingRef = useRef(false);

  const addTag = useCallback(() => {
    const name = inputValue.trim();
    if (!name) {
      setInputVisible(false);
      return;
    }
    if (tags.length >= maxCount) {
      setInputValue('');
      setInputVisible(false);
      return;
    }
    if (!tags.some((t) => t.name === name)) {
      const newTags = [...tags, { name }];
      onChange?.(tagsArrayToString(newTags));
    }
    setInputValue('');
    setInputVisible(false);
  }, [inputValue, tags, onChange, maxCount]);

  const removeTag = useCallback(
    (index: number) => {
      const newTags = tags.filter((_, i) => i !== index);
      onChange?.(tagsArrayToString(newTags));
    },
    [tags, onChange]
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', ...style }}>
      {tags.map((tag, i) => (
        <Tag
          key={tag.name}
          closable
          closeIcon={<CloseOutlined style={{ color: '#fff', fontSize: 10, marginLeft: 4 }} />}
          onClose={(e) => { e.preventDefault(); removeTag(i); }}
          style={{
            margin: 0,
            height: 22,
            boxSizing: 'border-box',
            borderRadius: token.borderRadiusSM,
            fontWeight: 500,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 10px',
            backgroundColor: themeColor,
            border: 'none',
            color: '#fff',
            fontSize: 12,
            lineHeight: '22px',
          }}
        >
          {tag.name}
        </Tag>
      ))}
      {showAddButton && inputVisible ? (
        <Input
          autoFocus
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onPressEnter={() => { if (composingRef.current) return; addTag(); }}
          onBlur={() => { if (composingRef.current) return; addTag(); }}
          placeholder={placeholder}
          size="small"
          variant="borderless"
          style={{
            width: 100,
            height: 22,
            fontSize: 12,
            padding: '0 4px',
            background: `${themeColor}14`,
            borderRadius: token.borderRadiusSM,
            border: `1px dashed ${themeColor}66`,
          }}
        />
      ) : (
        showAddButton && tags.length < maxCount && (
          <Tag
            onClick={() => setInputVisible(true)}
            style={{
              margin: 0,
              height: 22,
              boxSizing: 'border-box',
              borderRadius: token.borderRadiusSM,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 10px',
              background: 'transparent',
              border: `1px dashed ${themeColor}66`,
              color: themeColor,
              fontSize: 12,
              lineHeight: '22px',
            }}
          >
            + {placeholder}
          </Tag>
        )
      )}
      {showAddButton && tags.length >= maxCount && (
        <span style={{ fontSize: 12, color: token.colorTextQuaternary }}>最多添加 {maxCount} 个标签</span>
      )}
    </div>
  );
}
