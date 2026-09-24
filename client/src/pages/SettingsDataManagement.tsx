import { useTranslation } from 'react-i18next';
import { Tabs } from 'antd';
import { Navigate } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import CurrencyManager from '../components/setting/CurrencyManager';
import UnitManager from '../components/setting/UnitManager';

export default function SettingsDataManagementPage() {
  const { t } = useTranslation();
  const { hasPerm } = usePermission();

  // 仅拥有 数据管理 权限（默认管理员）可见，否则退回首页
  if (!hasPerm('system:data')) return <Navigate to="/" replace />;

  return (
    <div className="page-container">
      <div className="page-header">
        <h2>{t('dataManagement.title')}</h2>
      </div>
      <Tabs
        defaultActiveKey="currency"
        items={[
          { key: 'currency', label: t('currencyManager.title'), children: <CurrencyManager /> },
          { key: 'unit', label: t('unitManager.title'), children: <UnitManager /> },
        ]}
      />
    </div>
  );
}
