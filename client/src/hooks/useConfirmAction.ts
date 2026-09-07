import React, { useCallback } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';

export interface ConfirmActionOptions {
  /** 确认弹窗标题 */
  title: string;
  /** 补充说明（可选，支持 ReactNode） */
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  /** 确认后执行的异步操作（请求由调用方注入） */
  action: () => Promise<unknown>;
  /** 成功提示（可选，不传则不提示，由调用方自行处理） */
  successMessage?: string;
  /** 失败兜底提示（优先展示后端返回的 message） */
  errorMessage?: string;
  /** 成功后的额外回调：刷新列表 / 关闭弹窗等 */
  onSuccess?: () => void;
}

/**
 * 危险操作的统一确认逻辑（客户 / 线索等各模块复用）：
 * 1. 弹窗二次确认（统一「确定 / 取消」文案）
 * 2. 确认后执行 action，期间确定按钮保持 loading
 * 3. 成功：可选提示 + onSuccess 回调
 * 4. 失败：优先透出后端 message，否则用兜底文案
 *
 * 各模块只需传入自己的文案与请求，交互与错误处理保持一致。
 */
export function useConfirmAction() {
  const { modal, message } = App.useApp();
  const { t } = useTranslation();

  return useCallback(
    (options: ConfirmActionOptions) => {
      const {
        title,
        content,
        okText,
        cancelText,
        action,
        successMessage,
        errorMessage,
        onSuccess,
      } = options;

      modal.confirm({
        title,
        content,
        okText: okText ?? t('common.ok'),
        cancelText: cancelText ?? t('common.cancel'),
        onOk: async () => {
          try {
            await action();
            if (successMessage) message.success(successMessage);
            onSuccess?.();
          } catch (err: any) {
            message.error(err?.response?.data?.message || errorMessage || t('common.saveFailed'));
          }
        },
      });
    },
    [modal, message, t],
  );
}

export default useConfirmAction;
