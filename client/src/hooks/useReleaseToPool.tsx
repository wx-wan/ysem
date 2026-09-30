import { useCallback } from 'react';
import { App } from 'antd';
import { useTranslation } from 'react-i18next';
import { useConfirmAction } from './useConfirmAction';

export interface ReleaseToPoolOptions {
  /** 被释放对象名称（客户公司名 / 线索名称），用于确认文案 */
  name?: string;
  /**
   * 附加说明（可选）：用于声明本次释放的**联动效果**，
   * 例如线索释放时客户会一并放归公海。
   */
  note?: string;
  /** 执行释放请求（由调用方注入各自的 API） */
  action: () => Promise<unknown>;
  /** 释放成功后的回调（刷新列表 / 关闭弹窗等） */
  onSuccess?: () => void;
  /** 是否已在公海（无归属人）：已在此状态则直接提示，不发请求 */
  alreadyInPool?: boolean;
}

/**
 * 释放到公海（客户 / 线索共用）：文案、确认弹窗样式、成功失败提示全部统一，
 * 调用方只需传入名称与请求，避免各模块各写一套导致文案/样式不一致。
 */
export function useReleaseToPool() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const confirmAction = useConfirmAction();

  return useCallback(
    ({ name, note, action, onSuccess, alreadyInPool }: ReleaseToPoolOptions) => {
      // 已在公海：直接提示，不再弹确认（避免必然失败的请求）
      if (alreadyInPool) {
        message.info(name ? `${name} ${t('common.alreadyInPool')}` : t('common.alreadyInPool'));
        return;
      }

      const main = name
        ? t('common.confirmReleaseContent', { name })
        : t('common.confirmReleaseContentPlain');

      confirmAction({
        title: t('common.confirmReleaseTitle'),
        content: note ? (
          <>
            <div>{main}</div>
            <div style={{ marginTop: 8, color: 'var(--c-text-secondary, #64748b)' }}>{note}</div>
          </>
        ) : (
          main
        ),
        successMessage: t('common.releaseSuccess'),
        errorMessage: t('common.releaseFailed'),
        action,
        onSuccess,
      });
    },
    [t, message, confirmAction],
  );
}

export default useReleaseToPool;
