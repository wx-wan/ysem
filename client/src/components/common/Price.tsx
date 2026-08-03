import React from 'react';
import { useCurrencyStore } from '../../stores/useCurrencyStore';

interface PriceProps {
  /** CNY 基准金额（后端统一以 CNY 存储，组件内部按全局币种换算展示） */
  value: number | null | undefined;
  /** 加粗 */
  strong?: boolean;
  /** 透传样式 */
  style?: React.CSSProperties;
  /** 透传 className */
  className?: string;
  /** 前缀文案（如标题） */
  prefix?: React.ReactNode;
}

/**
 * 全局价格展示组件：所有金额统一走此组件，币种由 useCurrencyStore 全局控制。
 * 后端金额均以 CNY 存储，组件内部按当前币种换算展示。
 */
export const Price: React.FC<PriceProps> = ({ value, strong, style, className, prefix }) => {
  const { format } = useCurrencyStore();
  const text = format(Number(value || 0));
  return (
    <span className={className} style={{ fontWeight: strong ? 700 : undefined, ...style }}>
      {prefix}
      {text}
    </span>
  );
};

export default Price;
