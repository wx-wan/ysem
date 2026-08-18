import { AppstoreOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { useDs } from '../customer/shared/ds';

export type ViewMode = 'card' | 'list';

interface ViewModeSwitchProps {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}

/**
 * 卡片 / 列表视图切换。与客户管理页工具栏同款样式，作为共用组件提纯。
 */
export default function ViewModeSwitch({ value, onChange }: ViewModeSwitchProps) {
  const ds = useDs();
  const btn = (mode: ViewMode, title: string, icon: React.ReactNode) => (
    <button
      key={mode}
      onClick={() => onChange(mode)}
      title={title}
      style={{
        border: 'none',
        cursor: 'pointer',
        padding: '6px 10px',
        borderRadius: 6,
        background: value === mode ? ds.primaryBg : 'transparent',
        color: value === mode ? ds.primary : ds.textMuted,
        boxShadow: value === mode ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div style={{
      display: 'flex',
      background: ds.surface,
      borderRadius: ds.radius,
      padding: 2,
    }}>
      {btn('card', '卡片视图', <AppstoreOutlined />)}
      {btn('list', '列表视图', <UnorderedListOutlined />)}
    </div>
  );
}
