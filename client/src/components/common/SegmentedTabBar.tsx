import React from 'react';
import { Segmented } from 'antd';
import { theme } from 'antd';

/** 单个 tab 选项 */
export interface SegmentedTabOption {
  /** 唯一 key */
  key: string;
  /** 显示文字 */
  label: string;
  /** 右侧角标数字（可选） */
  count?: number;
}

export interface SegmentedTabBarProps {
  /** 当前选中 key */
  value: string;
  /** 切换回调 */
  onChange: (key: string) => void;
  /** tab 选项列表 */
  options: SegmentedTabOption[];
  /** 主题色（默认取 Ant Design colorPrimary） */
  activeColor?: string;
  /** 选中态背景色（默认等于 activeColor） */
  activeBg?: string;
  /** 未选中态文字色（默认 token.colorTextSecondary） */
  inactiveColor?: string;
  /** 是否显示 count 角标（默认 true） */
  showCount?: boolean;
  /** 整体容器额外样式 */
  style?: React.CSSProperties;
  /** 容器 className */
  className?: string;
}

/**
 * 通用 Segmented 风格 Tab 栏
 *
 * UI 特征：
 * - 圆角胶囊容器，浅灰底 + 细边框
 * - 每项：label + 可选 count 角标
 * - 选中态：主题色实底 + 白字
 * - 未选中态：灰色文字
 *
 * 用法示例：
 * ```tsx
 * <SegmentedTabBar
 *   value={active}
 *   onChange={setActive}
 *   options={[
 *     { key: 'all', label: '全部', count: 0 },
 *     { key: 'hot', label: '高意向', count: 5 },
 *   ]}
 *   activeColor="#1677ff"
 * />
 * ```
 */
const SegmentedTabBar: React.FC<SegmentedTabBarProps> = ({
  value,
  onChange,
  options,
  activeColor,
  activeBg,
  inactiveColor,
  style,
  className,
  showCount = true,
}) => {
  const { token } = theme.useToken();

  const color = activeColor ?? token.colorPrimary;
  const selectedBg = activeBg ?? color;
  const normalColor = inactiveColor ?? token.colorTextSecondary;

  return (
    <Segmented
      value={value}
      onChange={(v) => onChange(v as string)}
      options={options.map((o) => ({
        label: (
          <span>
            {o.label}
            {showCount && o.count != null && (
              <span
                style={{
                  marginLeft: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: value === o.key ? 'inherit' : token.colorTextTertiary,
                }}
              >
                {o.count}
              </span>
            )}
          </span>
        ),
        value: o.key,
      }))}
      style={{ flexShrink: 0, ...style, ['--seg-active-bg' as any]: selectedBg, ['--seg-active-color' as any]: normalColor }}
      className={`seg-tab-bar ${className ?? ''}`}
      styles={{
        root: {
          background: token.colorFillQuaternary,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 12,
          padding: 4,
        },
        item: {
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          color: normalColor,
          padding: '4px 14px',
          lineHeight: '22px',
        },
      }}
    />
  );
};

export default SegmentedTabBar;
