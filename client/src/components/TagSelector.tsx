import { useState, useCallback } from 'react';
import { Tag, Input, Button, Popover, theme } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';

// 标签预设色（固定为 红 黄 蓝 绿 青蓝 紫 黑，不带 # 前缀）
const TAG_PRESET_COLORS = [
  'f5222d', // 红
  'fadb14', // 黄
  '1890ff', // 蓝（默认）
  '52c41a', // 绿
  '13c2c2', // 青蓝
  '722ed1', // 紫
  '595959', // 黑
];

function tagColorToHex(tagColor: string, _token: any): string {
  if (!tagColor) return '#1890ff';
  return tagColor.startsWith('#') ? tagColor : `#${tagColor}`;
}

function parseTag(tagStr: string): { name: string; color: string } {
  const idx = tagStr.lastIndexOf('#');
  if (idx > 0) {
    return { name: tagStr.slice(0, idx), color: tagStr.slice(idx + 1) };
  }
  return { name: tagStr, color: TAG_PRESET_COLORS[0] };
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
  const [selectedColor, setSelectedColor] = useState('1890ff'); // 默认蓝色

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
    <div style={{ width: 264 }}>
      <div style={{
        fontSize: 13, fontWeight: 600, color: token.colorTextHeading,
        paddingBottom: 10, marginBottom: 12,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}>
        添加标签
      </div>

      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onPressEnter={addTag}
        placeholder={placeholder}
        size="middle"
        style={{ marginBottom: 14 }}
        variant="filled"
        autoFocus
      />

      <div style={{
        fontSize: 12, color: token.colorTextSecondary, marginBottom: 8,
      }}>
        选择颜色
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {TAG_PRESET_COLORS.map((c) => {
          const active = selectedColor === c;
          const hex = tagColorToHex(c, token);
          return (
            <div
              key={c}
              role="button"
              aria-label={c}
              onClick={() => setSelectedColor(c)}
              style={{
                cursor: 'pointer',
                width: 20,
                height: 20,
                borderRadius: '50%',
                backgroundColor: hex,
                boxShadow: active
                  ? `0 0 0 2px ${token.colorBgContainer}, 0 0 0 4px ${hex}`
                  : 'inset 0 0 0 1px rgba(0,0,0,0.08)',
                transition: 'box-shadow 0.15s ease, transform 0.15s ease',
                transform: active ? 'scale(1.1)' : 'scale(1)',
              }}
            />
          );
        })}
      </div>

      <Button
        type="primary"
        block
        onClick={addTag}
        disabled={!inputValue.trim()}
        style={{ borderRadius: token.borderRadiusSM }}
      >
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
              height: 20,
              boxSizing: 'border-box',
              borderRadius: token.borderRadiusSM,
              backgroundColor: token.colorBgContainer,
              color,
              border: `1px dashed ${color}`,
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 8px',
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
          styles={{ body: { padding: 16, borderRadius: token.borderRadiusLG } }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              boxSizing: 'border-box',
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
