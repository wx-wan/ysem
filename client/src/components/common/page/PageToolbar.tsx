import type { ReactNode, CSSProperties } from 'react';

interface PageToolbarProps {
  /** 左区：筛选控件 */
  children?: ReactNode;
  /** 右区：操作按钮组 */
  actions?: ReactNode;
  /** 第二行：子筛选栏等附加内容 */
  extra?: ReactNode;
  style?: CSSProperties;
}

/**
 * 通用页面工具栏：左筛选区 + 右按钮区，窄屏自动换行堆叠。
 * 页面框架组件，供客户 / 产品 / 销售等列表页复用。
 */
export default function PageToolbar({ children, actions, extra, style }: PageToolbarProps) {
  return (
    <div style={{ marginBottom: 16, ...style }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {children}
        </div>
        {actions && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginLeft: 'auto',
              flexShrink: 0,
            }}
          >
            {actions}
          </div>
        )}
      </div>
      {extra && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap' }}>{extra}</div>
      )}
    </div>
  );
}
