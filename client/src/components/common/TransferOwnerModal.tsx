import React, { useEffect, useMemo, useState } from 'react';
import { App, Modal, Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useUserStore } from '../../stores/useUserStore';
import { Z_INDEX } from '../../zIndex';

export interface TransferUserOption {
  id: string;
  realName?: string | null;
  username?: string;
}

interface Props {
  open: boolean;
  /** 被转交对象名称（客户公司名 / 线索名称），仅用于提示文案 */
  targetName?: string | null;
  /** 当前负责人 id：下拉中排除，避免转交给自己 */
  currentOwnerId?: string | null;
  /** 可选的用户列表；不传则统一取 useUserStore */
  userList?: TransferUserOption[];
  /** 执行转交：由调用方调用客户 / 线索各自的 API */
  onTransfer: (userId: string) => Promise<void>;
  onClose: () => void;
  /** 转交成功回调（关闭详情弹窗、刷新列表等） */
  onSuccess?: () => void;
  title?: string;
  placeholder?: string;
  successMessage?: string;
  errorMessage?: string;
}

/**
 * 转交负责人弹窗（客户 / 线索共用同一套选择 + 提交逻辑）：
 * - 下拉排除当前负责人，支持搜索
 * - 未选择时禁用确定，提交中显示 loading
 * - 具体的转交请求由调用方注入（客户 / 线索各自 API），失败时透出后端提示
 */
const TransferOwnerModal: React.FC<Props> = ({
  open,
  targetName,
  currentOwnerId,
  userList,
  onTransfer,
  onClose,
  onSuccess,
  title,
  placeholder,
  successMessage,
  errorMessage,
}) => {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const storeUsers = useUserStore((s) => s.users);
  const [userId, setUserId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const options = useMemo(() => {
    const source: TransferUserOption[] =
      userList && userList.length
        ? userList
        : (storeUsers || []).map((u) => ({ id: u.id, realName: u.realName, username: u.username }));
    return source
      .filter((u) => u.id !== currentOwnerId)
      .map((u) => ({ label: u.realName || u.username || u.id, value: u.id }));
  }, [userList, storeUsers, currentOwnerId]);

  // 每次打开重置选择，避免沿用上一次的用户
  useEffect(() => {
    if (open) setUserId(undefined);
  }, [open]);

  const handleOk = async () => {
    if (!userId) return;
    try {
      setLoading(true);
      await onTransfer(userId);
      message.success(successMessage || t('common.transferSuccess'));
      onClose();
      onSuccess?.();
    } catch (err: any) {
      message.error(err?.response?.data?.message || errorMessage || t('common.transferFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={title || t('common.transfer')}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText={t('common.ok')}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: !userId }}
      zIndex={Z_INDEX.overlay}
    >
      {targetName ? (
        <p style={{ marginTop: 12 }}>
          {t('common.transferTo')} <strong>{targetName}</strong>
        </p>
      ) : null}
      <Select
        style={{ width: '100%' }}
        showSearch
        optionFilterProp="label"
        value={userId}
        onChange={setUserId}
        placeholder={placeholder || t('common.selectOwner')}
        options={options}
      />
    </Modal>
  );
};

export default TransferOwnerModal;
