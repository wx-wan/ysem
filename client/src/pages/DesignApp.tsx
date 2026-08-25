import { useMemo, useState, type ReactNode } from 'react';
import { Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ShoppingOutlined,
  SwapOutlined,
  MessageOutlined,
  ApiOutlined,
  NodeIndexOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';
import UserManagementPage from './UserManagement';
import PermPage from './Perm';
import ProductManagementPage from './ProductManagement';
import OperationLogsPage from './OperationLogs';
import SettingsApprovalPage from './SettingsApproval';

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
  const { hasPerm } = usePermission();

  const groups: SettingGroup[] = [
    {
      key: 'basic',
      label: t('menu.settingBasic'),
      icon: <AppstoreOutlined />,
      children: [
        { key: 'user', label: t('menu.systemUser'), perm: 'system:user' },
        { key: 'perm', label: t('menu.systemPerm'), perm: 'system:perm' },
      ],
    },
    {
      key: 'sales',
      label: t('menu.settingSales'),
      icon: <ShoppingOutlined />,
      children: [{ key: 'archive', label: t('menu.systemArchive'), perm: 'product:taxonomy:view' }],
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
  );
}
