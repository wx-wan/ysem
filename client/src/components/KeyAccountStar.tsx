import { StarFilled, StarOutlined } from '@ant-design/icons';
import { useRef } from 'react';

interface KeyAccountStarProps {
  isKeyAccount: boolean;
  onToggle?: () => void;
  size?: number;
  color?: string;
  mutedColor?: string;
}

// 两次点击最小间隔（毫秒），低于此间隔的请求将被忽略，防止频繁触发
const DEBOUNCE_MS = 800;

// 静态星标：无持续动画 / 无光晕闪烁，无 loading 态。
// 点击后由父组件乐观更新 isKeyAccount prop，星标图标即时切换（实心↔空心），反馈零延迟。
export default function KeyAccountStar({
  isKeyAccount,
  onToggle,
  size = 20,
  color = '#faad14',
  mutedColor = '#bfbfbf',
}: KeyAccountStarProps) {
  const lastTriggerRef = useRef<number>(0);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    // 防抖：间隔过短直接忽略，避免频繁触发
    if (now - lastTriggerRef.current < DEBOUNCE_MS) return;
    lastTriggerRef.current = now;

    onToggle?.();
  };

  return (
    <span
      onClick={handleToggle}
      style={{
        cursor: 'pointer',
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size * 1.4,
        height: size * 1.4,
      }}
    >
      {isKeyAccount ? (
        <StarFilled style={{ color }} />
      ) : (
        <StarOutlined style={{ color: mutedColor }} />
      )}
    </span>
  );
}
