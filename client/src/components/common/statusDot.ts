import { createElement, type ReactNode } from 'react';

/**
 * 状态圆点 —— 与看板「近期订单」状态列同款：6px 实心圆。
 *
 * 样式走 class（`styles/global.css` 的 `.status-dot`）而非内联 style：
 * antd Tag 会把 `icon` 用 `cloneElement(icon, { style })` 重新包一层，
 * 内联 style 会被覆盖掉，className 则会被合并保留。
 * 颜色用 `currentColor`，自动跟随宿主（如 Tag）的文字色。
 */
export const STATUS_DOT: ReactNode = createElement('span', { className: 'status-dot' });
