import { useEffect, useState } from 'react';
import { Button, Typography } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import UserManagementPage from './UserManagement';
import PermPage from './Perm';
import ProductManagementPage from './ProductManagement';
import OperationLogsPage from './OperationLogs';
import SettingsApprovalPage from './SettingsApproval';

const { Title } = Typography;

type DesignTab = 'user' | 'perm' | 'archive' | 'logs' | 'approval';

export default function DesignApp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPerm } = usePermission();
  const [tab, setTab] = useState<DesignTab>('user');

  useEffect(() => {
    document.title = '设置 - Joylifetoy';
    return () => {
      document.title = 'Joylifetoy';
    };
  }, []);

  const TABS = [
    { label: t('menu.systemUser'), key: 'user' as const, perm: 'system:user' },
    { label: t('menu.systemPerm'), key: 'perm' as const, perm: 'system:perm' },
    { label: t('menu.systemArchive'), key: 'archive' as const, perm: 'product:taxonomy:view' },
    { label: '操作日志', key: 'logs' as const, perm: 'system:perm' },
    { label: '审批管理', key: 'approval' as const, perm: 'system:perm' },
  ].filter((x) => hasPerm(x.perm));

  // 去重（产品分类与证书都映射到 product 模块）
  const uniqueTabs = Array.from(new Map(TABS.map((x) => [x.key, x])).values());

  return (
    <div className="design-app">
      <div className="design-header">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/dashboard')}>
          返回
        </Button>
        <Title level={4} className="design-title" style={{ margin: 0 }}>{t('header.systemDesign')}</Title>
        <CapsuleSwitch
          className="design-top-nav"
          tone="primary"
          value={tab}
          options={uniqueTabs.map((x) => ({ label: x.label, key: x.key }))}
          onChange={(v) => setTab(v)}
        />
      </div>
      <div className="design-body">
        <div>
          {tab === 'user' && <UserManagementPage />}
          {tab === 'perm' && <PermPage />}
          {tab === 'archive' && <ProductManagementPage systemOnly />}
          {tab === 'logs' && <OperationLogsPage />}
          {tab === 'approval' && <SettingsApprovalPage />}
        </div>
      </div>
    </div>
  );
}
