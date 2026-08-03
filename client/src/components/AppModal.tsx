import React, { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Z_INDEX } from '../zIndex';

export interface AppModalProps {
  open: boolean;
  onClose: () => void;
  /** 标题区（可选），传 null 则不渲染 header */
  title?: ReactNode;
  /** 右上角自定义内容（如操作按钮），默认显示关闭叉 */
  extra?: ReactNode;
  children?: ReactNode;
  /** 弹窗宽度，默认 520 */
  width?: number | string;
  /** 是否垂直居中，默认 true */
  centered?: boolean;
  /** 点击遮罩是否关闭，默认 true */
  maskClosable?: boolean;
  /** 是否显示右上角关闭叉，默认 true */
  closable?: boolean;
  /** 底部内容，传 null 不渲染 */
  footer?: ReactNode;
  /** 容器 padding，默认 0（由内容自行控制） */
  bodyPadding?: number | string;
  /** 关闭时是否卸载子内容，默认 true */
  destroyOnHidden?: boolean;
  /** 自定义最外层 className */
  className?: string;
  /** 自定义最外层 style（覆盖默认） */
  style?: React.CSSProperties;
  /** 自定义 body style */
  bodyStyle?: React.CSSProperties;
}

const overlayBase: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: Z_INDEX.modalMask,
  display: 'flex',
  background: 'rgba(15, 23, 42, 0.45)',
  padding: 24,
  boxSizing: 'border-box',
};

const AppModal: React.FC<AppModalProps> = ({
  open,
  onClose,
  title,
  extra,
  children,
  width = 520,
  centered = true,
  maskClosable = true,
  closable = true,
  footer,
  bodyPadding = 0,
  destroyOnHidden = true,
  className,
  style,
  bodyStyle,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = React.useState(false);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 锁定 body 滚动
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  if (destroyOnHidden && closing) return null;

  const handleMaskClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && maskClosable) onClose();
  };

  const panelStyle: React.CSSProperties = {
    position: 'relative',
    width,
    maxWidth: '100%',
    maxHeight: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: '#fff',
    borderRadius: 16,
    boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
    overflow: 'hidden',
    ...style,
  };

  const showHeader = title !== undefined || closable || extra;
  const showFooter = footer !== undefined && footer !== null;

  const content = (
    <div style={{ ...overlayBase, alignItems: centered ? 'center' : 'flex-start', justifyContent: 'center' }} onClick={handleMaskClick}>
      <div ref={panelRef} className={className} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        {showHeader && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', flex: '0 0 auto' }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'rgba(0,0,0,0.88)' }}>{title}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {extra}
              {closable && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 18,
                    lineHeight: 1,
                    color: 'rgba(0,0,0,0.45)',
                    padding: 4,
                    borderRadius: 6,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(0,0,0,0.06)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
        <div style={{ flex: '1 1 auto', overflow: 'auto', padding: bodyPadding, ...bodyStyle }}>{children}</div>
        {showFooter && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid rgba(0,0,0,0.06)', flex: '0 0 auto' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
};

export default AppModal;
