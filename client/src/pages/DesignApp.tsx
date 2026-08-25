import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, Typography, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeftOutlined,
  AppstoreOutlined,
  ShoppingOutlined,
  SwapOutlined,
  MessageOutlined,
  ApiOutlined,
  NodeIndexOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';
import UserManagementPage from './UserManagement';
import PermPage from './Perm';
import ProductManagementPage from './ProductManagement';
import OperationLogsPage from './OperationLogs';
import SettingsApprovalPage from './SettingsApproval';

const { Title } = Typography;

type SettingItemKey = 'user' | 'perm' | 'archive' | 'logs' | 'approval';

interface SettingChild {
  key: SettingItemKey;
  label: string;
  perm: string;
}

interface SettingGroup {
  key: string;
  label: string;
  icon: ReactNode;
  children?: SettingChild[];
}

export default function DesignApp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPerm } = usePermission();

  useEffect(() => {
    document.title = '设置 - Joylifetoy';
    return () => {
      document.title = 'Joylifetoy';
    };
  }, []);

  const groups: SettingGroup[] = [
    {
      key: 'basic',
      label: t('menu.settingBasic'),
      icon: <AppstoreOutlined />,
      children: [
        { key: 'user', label: t('menu.systemUser'), perm: 'system:user' },
        { key: 'perm', label: t('menu.systemPerm'), perm: 'system:perm' },
        { key: 'archive', label: t('menu.systemArchive'), perm: 'product:taxonomy:view' },
      ],
    },
    {
      key: 'sales',
      label: t('menu.settingSales'),
      icon: <ShoppingOutlined />,
    },
    {
      key: 'trade',
      label: t('menu.settingTrade'),
      icon: <SwapOutlined />,
    },
    {
      key: 'communication',
      label: t('menu.settingCommunication'),
      icon: <MessageOutlined />,
    },
    {
      key: 'external',
      label: t('menu.settingExternal'),
      icon: <ApiOutlined />,
    },
    {
      key: 'workflow',
      label: t('menu.settingWorkflow'),
      icon: <NodeIndexOutlined />,
      children: [{ key: 'approval', label: '审批管理', perm: 'system:perm' }],
    },
    {
      key: 'data',
      label: t('menu.settingData'),
      icon: <BarChartOutlined />,
      children: [{ key: 'logs', label: '操作日志', perm: 'system:perm' }],
    },
  ];

  const firstKey = useMemo(() => {
    for (const g of groups) {
      const child = g.children?.find((c) => hasPerm(c.perm));
      if (child) return child.key;
    }
    return 'user';
  }, [groups, hasPerm]);

  const [selectedKey, setSelectedKey] = useState<SettingItemKey>(firstKey);

  const menuItems: MenuProps['items'] = useMemo(() => {
    return groups
      .map((g) => {
        const children = (g.children || [])
          .filter((c) => hasPerm(c.perm))
          .map((c) => ({ key: c.key, label: c.label }));
        if (!children.length) return null;
        return {
          key: g.key,
          icon: g.icon,
          label: g.label,
          children,
        };
      })
      .filter(Boolean) as MenuProps['items'];
  }, [groups, hasPerm]);

  return (
    <div className="design-app">
      <div className="design-header">
        <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/dashboard')}>
          返回
        </Button>
        <Title level={4} className="design-title" style={{ margin: 0 }}>
          {t('header.systemDesign')}
        </Title>
      </div>
      <div className="design-layout">
        <aside className="design-sider">
          <Menu
            mode="inline"
            theme="light"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={(info) => setSelectedKey(info.key as SettingItemKey)}
          />
        </aside>
        <main className="design-main">
          {selectedKey === 'user' && <UserManagementPage />}
          {selectedKey === 'perm' && <PermPage />}
          {selectedKey === 'archive' && <ProductManagementPage systemOnly />}
          {selectedKey === 'logs' && <OperationLogsPage />}
          {selectedKey === 'approval' && <SettingsApprovalPage />}
        </main>
      </div>
    </div>
  );
}
