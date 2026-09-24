import React from 'react';
import { CaretUpFilled, CaretDownOutlined } from '@ant-design/icons';

interface Props {
  /** 是否展开：展开显示向上、收起显示向下 */
  expanded: boolean;
  /** 图标字号，默认 10 */
  size?: number;
  /** 图标颜色 */
  color?: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * 上下切换指示图标（展开/收起通用）：
 * - 展开：CaretUpFilled（实心向上三角）
 * - 收起：CaretDownOutlined（描边向下三角）
 * 全站涉及「上下切换」的指示器统一使用本组件，便于整体替换样式。
 */
export default function ExpandChevron({ expanded, size = 10, color, className, style }: Props) {
  const iconStyle: React.CSSProperties = { fontSize: size, color, ...style };
  return expanded ? (
    <CaretUpFilled className={className} style={iconStyle} />
  ) : (
    <CaretDownOutlined className={className} style={iconStyle} />
  );
}
