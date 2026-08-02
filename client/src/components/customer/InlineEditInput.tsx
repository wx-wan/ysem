import React from 'react';
import { Input, type InputProps } from 'antd';

// 就地编辑专用输入框：边框下沉风格（无填充背景，聚焦时内阴影 + 边框下沉）
// dark=true（默认）：白色文字 + 白色边框，用于卡片头部渐变区
// dark=false：深色文字，用于浅色背景区域
interface InlineEditInputProps extends InputProps {
  dark?: boolean;
}
const InlineEditInput: React.FC<InlineEditInputProps> = (props) => {
  const { size = 'small', variant = 'outlined', dark = true, style, ...rest } = props;
  const textColor = dark ? 'rgba(255,255,255,0.95)' : '#1f2937';
  const borderColor = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.18)';
  const borderColorFocus = dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.4)';
  const shadow = dark ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.12)';
  return (
    <Input
      size={size}
      variant={variant}
      {...rest}
      style={{
        background: 'transparent',
        border: `1px solid ${borderColor}`,
        borderRadius: 8,
        color: textColor,
        caretColor: textColor,
        // 默认状态：轻微外阴影，营造"浮起"感
        boxShadow: `0 1px 2px ${shadow}`,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease, transform 0.15s ease',
        ...style,
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 2px 4px ${shadow}`;
        e.currentTarget.style.borderColor = borderColorFocus;
        e.currentTarget.style.transform = 'translateY(1px)';
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = `0 1px 2px ${shadow}`;
        e.currentTarget.style.borderColor = borderColor;
        e.currentTarget.style.transform = 'translateY(0)';
        props.onBlur?.(e);
      }}
    />
  );
};

export default InlineEditInput;
