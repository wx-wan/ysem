import { theme } from 'antd';

/**
 * 客户模块统一设计 token。
 * 收敛散落的魔法数字与硬编码色（#f1f5f9 / #64748b / #94a3b8 等），
 * 全部接入 antd theme token，确保明暗主题下视觉一致、不崩。
 *
 * 用法：
 *   const ds = useDs();
 *   <div style={{ height: ds.control, borderRadius: ds.radius, background: ds.surface }} />
 */
export function useDs() {
  const { token } = theme.useToken();
  return {
    // ---- 尺寸 ----
    /** 主操作控件高度（Input / Select / DatePicker / TagSelector 外壳） */
    control: 40,
    /** 紧凑控件高度（工具栏按钮、分页器） */
    controlSm: 32,
    /** 基准圆角 */
    radius: 8,
    /** 胶囊圆角 */
    radiusPill: 999,

    // ---- 中性灰阶（基于 token 推导，明暗自适应） ----
    /** 浅灰底（胶囊背景、进度条轨道） */
    surface: token.colorFillQuaternary,
    /** 次级浅灰（子筛选条背景） */
    surfaceSub: token.colorFillTertiary,
    /** 默认文字灰 */
    textMuted: token.colorTextSecondary,
    /** 弱化文字灰（未选中筛选标签） */
    textFaint: token.colorTextTertiary,
    /** 描边灰 */
    border: token.colorBorder,
    /** 区块分隔线 */
    divider: token.colorBorderSecondary,

    // ---- 语义色（复用 token，避免硬编码） ----
    primary: token.colorPrimary,
    primaryBg: token.colorPrimaryBg,
    primaryBgHover: token.colorPrimaryBgHover,
    success: token.colorSuccess,
    warning: token.colorWarning,
    error: token.colorError,
    info: token.colorInfo,

    // ---- 通用阴影 ----
    shadowCard: token.boxShadowSecondary,
    shadowPop: '0 6px 24px rgba(0,0,0,0.12)',
  };
}

/** 不依赖 Hook 的静态中性灰（用于无法调用 Hook 的模块级常量场景） */
export const NEUTRAL = {
  surface: '#f1f5f9',
  surfaceSub: '#f8fafc',
  textMuted: '#64748b',
  textFaint: '#94a3b8',
};
