import React from 'react';
import { theme } from 'antd';

export interface ChipOption {
  label: React.ReactNode;
  value: string;
  disabled?: boolean;
}

interface ChipSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: ChipOption[];
  disabled?: boolean;
  /** 选中底色，默认主题色 */
  activeColor?: string;
  /** 每行等分数量；不传则按内容自然换行（每个 chip 宽度随文案） */
  columns?: number;
  /** chip 尺寸，默认 large，与 antd 大号输入框（高 40px）对齐 */
  size?: 'large' | 'middle' | 'small';
  style?: React.CSSProperties;
}

/**
 * ChipSelect：chip 标签式单选（替代下拉）。
 * 未选中：白底 + 浅描边 + 圆角 8；选中：主题色实心 + 白字 + 加粗。
 */
const ChipSelect: React.FC<ChipSelectProps> = ({ value, onChange, options, disabled, activeColor, columns, size = 'large', style }) => {
  const { token } = theme.useToken();
  const active = activeColor || token.colorPrimary;
  const gap = 12;

  // 尺寸 → chip 内边距（横向固定 16，纵向按高度反推，使整颗 chip 高度与对应 antd 输入框一致）
  const paddingMap: Record<NonNullable<ChipSelectProps['size']>, string> = {
    large: '8px 16px', // 22 + 16 + 2(border) = 40px，对齐 Input size=large
    middle: '4px 16px', // 22 + 8 + 2 = 32px，对齐 Input size=middle
    small: '0px 12px', // 22 + 0 + 2 = 24px，对齐 Input size=small
  };
  const chipPadding = paddingMap[size];

  // columns 传入时：每行等分 N 个、宽度一致、文字居中
  const itemFlex = columns && columns > 0 ? `0 0 calc((100% - ${(columns - 1) * gap}px) / ${columns})` : undefined;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap, width: '100%', ...style }}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        const isDisabled = disabled || opt.disabled;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange?.(opt.value)}
            style={{
              flex: itemFlex,
              textAlign: columns ? 'center' : undefined,
              minWidth: 0,
              border: `1px solid ${isActive ? active : token.colorBorderSecondary}`,
              background: isActive ? active : token.colorBgContainer,
              color: isActive ? '#fff' : token.colorText,
              borderRadius: 8,
              padding: chipPadding,
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              lineHeight: '22px',
              cursor: isDisabled ? 'not-allowed' : 'pointer',
              opacity: isDisabled ? 0.5 : 1,
              transition: 'all .2s ease',
            }}
            onMouseEnter={(e) => {
              if (!isActive && !isDisabled) e.currentTarget.style.borderColor = active;
            }}
            onMouseLeave={(e) => {
              if (!isActive) e.currentTarget.style.borderColor = token.colorBorderSecondary;
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
};

export default ChipSelect;
