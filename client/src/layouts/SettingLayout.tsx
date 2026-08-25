import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Layout, Menu, Spin, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ShoppingOutlined,
  SwapOutlined,
  MessageOutlined,
  ApiOutlined,
  NodeIndexOutlined,
  BarChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { usePermission } from '../hooks/usePermission';
import { authApi } from '../api/auth';
import HeaderTools from './HeaderTools';

const { Sider, Header, Content } = Layout;

interface SettingChild {
  key: string;
  label: string;
  perm: string;
}

interface SettingGroup {
  key: string;
  label: string;
  icon: React.ReactNode;
  children?: SettingChild[];
}

export default function SettingLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { fetchRates, loading: ratesLoading } = useCurrencyStore();
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);

  const profileFetched = useRef(false);
  useEffect(() => {
    if (!user && !profileFetched.current) {
      profileFetched.current = true;
      authApi.getProfile().then((res) => {
        const profile = res.data.data;
        const permissions =
          profile?.role?.permissions?.map((rp: { permission: { code: string } }) => rp.permission.code) ?? [];
        useAuthStore.getState().setAuth(
          { ...profile, permissions },
          localStorage.getItem('accessToken') || '',
          localStorage.getItem('refreshToken') || '',
        );
      }).catch(() => {
        logout();
        navigate('/login');
      });
    }
  }, []);

  useEffect(() => {
    fetchRates();
  }, []);

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

  const menuItems: MenuProps['items'] = groups
    .map((g) => {
      const children = (g.children || [])
        .filter((c) => hasPerm(c.perm))
        .map((c) => ({ key: `/setting/${c.key}`, label: c.label }));
      if (!children.length) return null;
      return { key: g.key, icon: g.icon, label: g.label, children };
    })
    .filter(Boolean) as MenuProps['items'];

  const pageTitle = useMemo(() => {
    return location.pathname.startsWith('/setting') ? '系统设置 - Joylifetoy' : 'Joylifetoy';
  }, [location.pathname]);
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);

  const handleLogout = () => {
    authApi.logout().finally(() => {
      logout();
      navigate('/login');
    });
  };

  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (key.startsWith('/')) navigate(key);
  };

  // 默认选中项
  const selectedKey = (() => {
    const m = location.pathname.match(/^\/setting\/(.+)$/);
    return m ? `/setting/${m[1]}` : '';
  })();

  // 精确 /setting 重定向到第一个有权限的子模块
  if (location.pathname === '/setting') {
    const first = groups.flatMap((g) => g.children || []).find((c) => hasPerm(c.perm));
    return <Navigate to={`/setting/${first ? first.key : 'user'}`} replace />;
  }

  return (
    <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
      <Sider
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={232}
        style={{
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflow: 'auto',
        }}
      >
        <div
          className="sider-brand"
          onClick={() => navigate('/dashboard')}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <img className="brand-icon" src="/logo.png" alt="Logo" draggable={false} />
          <span className="brand-text">Joylifetoy</span>
        </div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['basic', 'sales', 'workflow', 'data']}
          items={menuItems}
          onClick={handleMenuClick}
          style={{ borderInlineEnd: 'none', background: 'transparent' }}
        />
      </Sider>

      <Layout>
        <Header
          className="top-header"
          style={{
            background: token.colorBgContainer,
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className="sider-trigger"
              onClick={() => setCollapsed((c) => !c)}
              style={{ fontSize: 18, cursor: 'pointer', color: token.colorTextSecondary }}
            >
              {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            </span>
            <span style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>系统设置</span>
          </div>
          <HeaderTools user={user} onLogout={handleLogout} onMenuClick={handleMenuClick} />
        </Header>

        <Content className="page-container" style={{ padding: 20, overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>

      {ratesLoading && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            background: 'rgba(255, 255, 255, 0.65)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <Spin size="large" />
        </div>
      )}
    </Layout>
  );
}
