import { Tooltip, Space } from 'antd';
import type { ReactNode } from 'react';
import { CommToolIcon } from './CommToolIcon';

interface MethodItem {
  tool?: string | null;
  account?: string | null;
}

interface Props {
  methods?: MethodItem[] | null;
  /** 无数据时的占位（默认 "-"） */
  empty?: ReactNode;
  size?: 'small' | 'middle' | 'large';
  iconStyle?: React.CSSProperties;
  /** 账号文本样式（如颜色、字号） */
  textStyle?: React.CSSProperties;
}

/**
 * 联系方式统一展示：icon + 值（不再显示「工具：」前缀）。
 * icon 取系统设置 → 沟通工具维护中该工具的图标；工具名作为 hover 提示。
 */
export default function ContactMethodsView({ methods, empty = '-', size = 'small', iconStyle, textStyle }: Props) {
  const list = (methods || []).filter((m) => m && (m.tool || m.account));
  if (!list.length) return <>{empty}</>;

  return (
    <Space size={[8, 4]} wrap>
      {list.map((m, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Tooltip title={m.tool || undefined}>
            <CommToolIcon name={m.tool} style={{ fontSize: size === 'large' ? 16 : 14, color: '#1677ff', ...iconStyle }} />
          </Tooltip>
          <span style={{ minWidth: 0, wordBreak: 'break-word', ...textStyle }}>{m.account}</span>
        </span>
      ))}
    </Space>
  );
}
