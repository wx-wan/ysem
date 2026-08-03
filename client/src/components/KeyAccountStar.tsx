import { StarFilled, StarOutlined } from '@ant-design/icons';
import { useRef, useState } from 'react';
import { customerApi } from '../api/customers';

interface KeyAccountStarProps {
  isKeyAccount: boolean;
  customerId?: string;
  onToggle?: () => void;
  size?: number;
  color?: string;
  mutedColor?: string;
}

// 两次点击最小间隔（毫秒），低于此间隔的请求将被忽略，防止频繁触发
const DEBOUNCE_MS = 800;

// 静态星标：无持续动画 / 无光晕闪烁，仅保留点击反馈（loading 透明度）
export default function KeyAccountStar({
  isKeyAccount,
  customerId,
  onToggle,
  size = 20,
  color = '#faad14',
  mutedColor = '#bfbfbf',
}: KeyAccountStarProps) {
  const [loading, setLoading] = useState(false);
  const lastTriggerRef = useRef<number>(0);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const now = Date.now();
    // 防抖：间隔过短直接忽略，避免频繁触发
    if (now - lastTriggerRef.current < DEBOUNCE_MS) return;
    lastTriggerRef.current = now;

    if (!customerId) {
      onToggle?.();
      return;
    }
    setLoading(true);
    try {
      await customerApi.update(customerId, { isKeyAccount: !isKeyAccount } as any);
      onToggle?.();
    } catch {
      // 静默失败，不弹提示框
    } finally {
      setLoading(false);
    }
  };

  return (
    <span
      onClick={handleToggle}
      style={{
        cursor: 'pointer',
        fontSize: size,
        lineHeight: 1,
        opacity: loading ? 0.5 : 1,
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
