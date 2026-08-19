import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** 自定义图标（默认 📭 表情） */
  icon?: ReactNode;
  title?: string;
  description?: string;
  /** 底部操作按钮区 */
  action?: ReactNode;
}

/**
 * 通用空状态：图标 + 标题 + 描述 + 可选操作。
 * 页面框架组件，供客户 / 产品等列表页复用。
 */
export default function EmptyState({
  icon,
  title = '暂无数据',
  description,
  action,
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 44, lineHeight: 1 }}>{icon ?? '📭'}</div>
      <div style={{ marginTop: 16, fontSize: 15, fontWeight: 600, color: 'rgba(0,0,0,0.88)' }}>
        {title}
      </div>
      {description && (
        <div style={{ marginTop: 6, fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 20 }}>{action}</div>}
    </div>
  );
}
