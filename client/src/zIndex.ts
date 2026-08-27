// 全局层级（z-index）统一管理
// 所有涉及浮层/弹窗/抽屉层级的组件都应从这里取值，避免散落的魔法数字互相覆盖。

export const Z_INDEX = {
  /** 基础浮层（dropdown / tooltip / message 等 antd 默认浮层） */
  base: 1000,
  /** 居中弹窗遮罩（AppModal） */
  modalMask: 1000,
  /** 居中弹窗面板 */
  modal: 1001,
  /** 侧边抽屉遮罩（层级应高于普通弹窗，避免点击穿透） */
  drawerMask: 1990,
  /** 侧边抽屉面板 */
  drawer: 2000,
  /** antd 原生 Modal / Drawer 统一层级（替代散落的 zIndex={2000} 硬编码） */
  overlay: 2000,
  /** antd 原生 Modal 嵌套弹窗层级（如表单内再弹导入框） */
  overlayNested: 2100,
  /** 最高层级（引导/强制提示等） */
  top: 3000,
} as const;

/**
 * 生成 antd 浮层挂载函数，让下拉/日期等 popup 渲染到指定容器内，
 * 避免被高层级容器裁切或遮挡。
 *
 * @param ref 浮层希望挂载到的容器 ref（通常是弹窗/抽屉的内容滚动容器）
 */
export function createPopupContainer(
  ref: React.RefObject<HTMLElement | null>,
): (triggerNode: HTMLElement) => HTMLElement {
  return () => ref.current ?? document.body;
}
