import React from 'react';
import { theme } from 'antd';

export interface CapsuleOption<T extends string = string> {
  key: T;
  label: string;
  /** 右侧计数角标（可选） */
  count?: number;
}

interface Props<T extends string = string> {
  value: T;
  options: CapsuleOption<T>[];
  onChange: (key: T) => void;
  /** 风格：primary 主筛选（实心主色）；sub 子筛选（浅底主色） */
  tone?: 'primary' | 'sub';
  /** 自定义主色（默认取 Ant Design colorPrimary） */
  activeColor?: string;
  /** 是否显示 count 角标（默认 true） */
  showCount?: boolean;
  /** 窄屏横向滚动（默认 true） */
  scrollable?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 通用胶囊切换组件（仿客户页「公海/重点」）。
 * - tone="primary"：实心主色高亮（主筛选 / 页面级切换）
 * - tone="sub"：浅底主色高亮（子筛选）
 * 同时支持 count 角标与自定义主色，覆盖筛选 / 视图切换等场景。
 */
export default function CapsuleSwitch<T extends string = string>({
  value,
  options,
  onChange,
  tone = 'primary',
  activeColor,
  showCount = true,
  scrollable = true,
  className,
  style,
}: Props<T>) {
  const { token } = theme.useToken();
  const color = activeColor ?? token.colorPrimary;
  const isPrimary = tone === 'primary';

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        background: isPrimary ? '#f1f5f9' : token.colorFillTertiary,
        borderRadius: 24,
        padding: '3px 4px',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: scrollable ? 'auto' : 'visible',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              border: 'none',
              outline: 'none',
              cursor: 'pointer',
              padding: isPrimary ? '5px 14px' : '4px 10px',
              borderRadius: 20,
              fontSize: isPrimary ? 13 : 12,
              fontWeight: active ? 600 : 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.25s ease',
              flexShrink: 0,
              background: active
                ? isPrimary ? color : `${color}1a`
                : 'transparent',
              color: active
                ? isPrimary ? '#fff' : color
                : isPrimary ? '#64748b' : token.colorTextTertiary,
              boxShadow: active && isPrimary ? `0 2px 8px ${color}4d` : 'none',
            }}
          >
            {opt.label}
            {showCount && typeof opt.count === 'number' && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: active ? (isPrimary ? color : `${color}33`) : token.colorFillQuaternary,
                  color: active ? (isPrimary ? '#fff' : color) : token.colorTextTertiary,
                  lineHeight: '16px',
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
