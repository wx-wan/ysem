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
 * 通用胶囊切换组件（分段控件风格）：
 * - 浅灰容器，选中项为「白底药丸 + 主色文字 + 轻投影」，未选中为灰字；
 * - 支持 count 角标、自定义主色、窄屏横向滚动。
 * 用于筛选 / 视图切换等分段场景。
 */
export default function CapsuleSwitch<T extends string = string>({
  value,
  options,
  onChange,
  activeColor,
  showCount = true,
  scrollable = true,
  className,
  style,
}: Props<T>) {
  const { token } = theme.useToken();
  const color = activeColor ?? token.colorPrimary;
  // 外部传入 borderRadius 时内外圆角联动（内 = 外 - 容器 padding），否则用默认值
  const outerRadius = (style && typeof style.borderRadius !== 'undefined' ? style.borderRadius : 12) as number;
  const innerRadius = typeof outerRadius === 'number' ? Math.max(outerRadius - 3, 4) : 9;

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        background: '#f1f5f9',
        borderRadius: outerRadius,
        height: token.controlHeight,
        boxSizing: 'border-box',
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
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              padding: '0 14px',
              borderRadius: innerRadius,
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.25s ease',
              flexShrink: 0,
              background: active ? token.colorBgContainer : 'transparent',
              color: active ? color : '#64748b',
              boxShadow: active ? '0 1px 3px rgba(15, 23, 42, 0.12)' : 'none',
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
                  background: active ? `${color}1a` : token.colorFillSecondary,
                  color: active ? color : token.colorTextSecondary,
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
