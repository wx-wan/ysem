import { useTranslation } from 'react-i18next';
import { Button } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import AppModal from './AppModal';
import { useUserStore } from '../stores/useUserStore';
import { useAuthStore } from '../stores/useAuthStore';

/**
 * 权限/数据范围变更确认刷新弹窗。
 * 收到 SSE 通知且当前登录用户属于被变更角色时弹出，禁止关闭，仅可「立即刷新」。
 * 使用项目自定义 AppModal 渲染，避免 antd Modal 的弃用警告。
 */
export default function PermChangedModal() {
  const { t } = useTranslation();
  const permChangedRoleId = useUserStore((s) => s.permChangedRoleId);
  const dismissPermChanged = useUserStore((s) => s.dismissPermChanged);

  const open = !!permChangedRoleId;

  const handleRefresh = () => {
    const roleId = permChangedRoleId;
    dismissPermChanged();
    if (roleId) useAuthStore.getState().reloadUser();
  };

  return (
    <AppModal
      open={open}
      onClose={handleRefresh}
      width={360}
      closable={false}
      maskClosable={false}
      className="perm-changed-modal"
      footer={
        <Button type="primary" block size="large" onClick={handleRefresh}>
          {t('role.permChangedRefresh')}
        </Button>
      }
    >
      <div className="perm-changed-body">
        <div className="perm-changed-icon">
          <SafetyCertificateOutlined />
        </div>
        <div className="perm-changed-text">
          <div className="perm-changed-title">{t('role.permChangedTitle')}</div>
          <div className="perm-changed-desc">{t('role.permChangedContent')}</div>
        </div>
      </div>
    </AppModal>
  );
}
