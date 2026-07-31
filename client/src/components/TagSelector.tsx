import { useState, useCallback } from 'react';
import { Tag, Input, Button, Popover, theme } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';

// 标签预设色（Ant Design 语义色名）
const TAG_PRESET_COLORS = [
  'magenta', 'red', 'volcano', 'orange', 'gold', 'lime',
  'green', 'cyan', 'blue', 'geekblue', 'purple',
];

// tagColor → 深色主色 token
function tagColorToHex(tagColor: string, token: any): string {
  const map: Record<string, string> = {
    red: token.colorError,
    magenta: token.colorError,
    volcano: token.colorError,
    orange: token.colorWarning,
    gold: token.colorWarning,
    green: token.colorSuccess,
    lime: token.colorSuccess,
    cyan: token.colorInfo,
    blue: token.colorInfo,
    geekblue: token.colorInfo,
    purple: token.colorPrimary,
  };
  return map[tagColor] || token.colorPrimary;
}

function parseTag(tagStr: string): { name: string; color: string } {
  const idx = tagStr.lastIndexOf('#');
  if (idx > 0) {
    return { name: tagStr.slice(0, idx), color: tagStr.slice(idx + 1) };
  }
  return { name: tagStr, color: 'blue' };
}

function tagsToArray(tags?: string): { name: string; color: string }[] {
  if (!tags) return [];
  return tags.split(',').filter(Boolean).map(parseTag);
}

function tagsArrayToString(tags: { name: string; color: string }[]): string {
  return tags.map((t) => `${t.name}#${t.color}`).join(',');
}

export interface TagSelectorProps {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  showAddButton?: boolean;
}

export default function TagSelector({ value, onChange, placeholder = '输入标签名称', showAddButton = true }: TagSelectorProps) {
  const { token } = theme.useToken();
  const tags = tagsToArray(value);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_PRESET_COLORS[0]);

  const addTag = useCallback(() => {
    const name = inputValue.trim();
    if (!name) return;
    if (tags.some((t) => t.name === name)) {
      setInputValue('');
      return;
    }
    const newTags = [...tags, { name, color: selectedColor }];
    onChange?.(tagsArrayToString(newTags));
    setInputValue('');
    setOpen(false);
  }, [inputValue, tags, selectedColor, onChange]);

  const removeTag = useCallback(
    (index: number) => {
      const newTags = tags.filter((_, i) => i !== index);
      onChange?.(tagsArrayToString(newTags));
    },
    [tags, onChange]
  );

  const popoverContent = (
    <div style={{ width: 280 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: token.colorTextHeading }}>
        添加标签
      </div>
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPressEnter={addTag}
        placeholder={placeholder}
        style={{ marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {TAG_PRESET_COLORS.map((c) => (
          <div
            key={c}
            onClick={() => setSelectedColor(c)}
            style={{
              cursor: 'pointer',
              width: 22,
              height: 22,
              borderRadius: '50%',
              backgroundColor: tagColorToHex(c, token),
              border:
                selectedColor === c
                  ? `2px solid ${token.colorText}`
                  : '2px solid transparent',
              transform: selectedColor === c ? 'scale(1.15)' : 'scale(1)',
              transition: 'all 0.15s ease',
              boxShadow:
                selectedColor === c
                  ? `0 0 0 2px ${token.colorBgContainer}, 0 0 0 4px ${tagColorToHex(c, token)}`
                  : 'none',
            }}
          />
        ))}
      </div>
      <Button type="primary" block size="small" onClick={addTag} disabled={!inputValue.trim()}>
        添加
      </Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {tags.map((tag, i) => {
        const color = tagColorToHex(tag.color, token);
        return (
          <Tag
            key={tag.name}
            bordered={false}
            closable
            closeIcon={
              <CloseOutlined style={{ color, fontSize: 10, marginLeft: 4 }} />
            }
            onClose={() => removeTag(i)}
            style={{
              margin: 0,
              borderRadius: token.borderRadiusSM,
              backgroundColor: token.colorBgContainer,
              color,
              border: `1px solid ${color}`,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {tag.name}
          </Tag>
        );
      })}
      {showAddButton && (
        <Popover
          content={popoverContent}
          open={open}
          onOpenChange={setOpen}
          trigger="click"
          placement="bottomLeft"
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: token.borderRadiusSM,
              border: `1px dashed ${token.colorBorder}`,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: token.colorTextSecondary,
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = token.colorPrimary;
              e.currentTarget.style.color = token.colorPrimary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = token.colorBorder;
              e.currentTarget.style.color = token.colorTextSecondary;
            }}
          >
            <PlusOutlined style={{ fontSize: 12 }} />
          </div>
        </Popover>
      )}
    </div>
  );
}
