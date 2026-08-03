import React from 'react';
import { Tag } from 'antd';

// ========== 采购意向标签（纯展示组件） ==========
// 父级传入 label 和 style，样式由调用方根据场景自行决定
// 卡片视图（深色头部）：白字半透明背景
// 详情视图（浅色区域）：用全局 tagColorToHex/tagColorToBg
// 组件本身不包含任何业务逻辑和颜色判断

interface Props {
  label: string;
  size?: 'small' | 'default';
  /** 调用方自定义样式，不在此硬编码 */
  style?: React.CSSProperties;
}

export default function PurchaseIntentTag({ label, size = 'small', style }: Props) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: size === 'small' ? 11 : 12,
        fontWeight: 600,
        lineHeight: size === 'small' ? '18px' : '20px',
        paddingInline: size === 'small' ? 10 : 14,
        paddingBlock: size === 'small' ? 3 : 4,
        borderRadius: 8,
        ...style,
      }}
    >
      {label}
    </span>
  );
}
