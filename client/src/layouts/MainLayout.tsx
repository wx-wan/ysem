import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, theme, Grid } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  ShoppingOutlined,
  AppstoreOutlined,
  ProjectOutlined,
  ThunderboltOutlined,
  ShoppingCartOutlined,
  UnorderedListOutlined,
  SolutionOutlined,
  ProfileOutlined,
  ClusterOutlined,
  ReconciliationOutlined,
  SendOutlined,
  TeamOutlined,
  BarChartOutlined,
  SettingOutlined,
  UserOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { authApi } from '../api/auth';
import HeaderTools from './HeaderTools';

const { Sider, Header, Content } = Layout;

// 路由 → 页面名映射
const routeTitles: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/sales': '销售管理',
  '/sales/products': '产品',
  '/sales/leads': '线索',
  '/sales/opportunities': '商机',
  '/sales/orders': '订单',
  '/production': '生产管理',
  '/shipment': '发货管理',
  '/customers': '客户管理',
  '/reports': '数据报表',
  '/system/user': '用户管理',
  '/system/role': '角色管理',
  '/system/dept': '部门管理',
  '/system/perm': '权限管理',
};

export default function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { fetchRates, loading: ratesLoading } = useCurrencyStore();
  const { token } = theme.useToken();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);

  // 获取用户信息（防 StrictMode 双重挂载重复请求）
  const profileFetched = useRef(false);
  useEffect(() => {
    if (!user && !profileFetched.current) {
      profileFetched.current = true;
      authApi.getProfile().then((res) => {
        useAuthStore.getState().setAuth(
          res.data.data,
          localStorage.getItem('accessToken') || '',
          localStorage.getItem('refreshToken') || '',
        );
      }).catch(() => {
        logout();
        navigate('/login');
      });
    }
  }, []);

  // 获取汇率
  useEffect(() => {
    fetchRates();
  }, []);

  // 动态设置标签页标题
  const pageTitle = useMemo(() => {
    const name = routeTitles[location.pathname] || '';
    return name ? `${name} - Joylifetoy` : 'Joylifetoy';
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

  const roleCode = user?.role?.code || 'user';
  const isAdmin = roleCode === 'admin';

  // 侧边栏菜单
  const menuItems: MenuProps['items'] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('menu.dashboard') },
    {
      key: 'sales-group',
      icon: <ShoppingOutlined />,
      label: t('menu.sales'),
      children: [
        { key: '/sales/products', icon: <AppstoreOutlined />, label: t('menu.products') },
        { key: '/sales/leads', icon: <ProjectOutlined />, label: t('sales.lead') },
        { key: '/sales/opportunities', icon: <ThunderboltOutlined />, label: t('sales.opportunity') },
        { key: '/sales/orders', icon: <ShoppingCartOutlined />, label: t('menu.orders') },
      ],
    },
    { key: '/production', icon: <UnorderedListOutlined />, label: t('menu.production') },
    { key: '/shipment', icon: <SendOutlined />, label: t('menu.shipment') },
    { key: '/customers', icon: <TeamOutlined />, label: t('menu.customers') },
    { key: '/reports', icon: <BarChartOutlined />, label: t('menu.reports') },
    ...(isAdmin
      ? [
          {
            key: 'system-group',
            icon: <SettingOutlined />,
            label: t('menu.system'),
            children: [
              { key: '/system/user', icon: <UserOutlined />, label: t('menu.systemUser') },
              { key: '/system/role', icon: <ClusterOutlined />, label: t('menu.systemRole') },
              { key: '/system/dept', icon: <ApartmentOutlined />, label: t('menu.systemDept') },
              { key: '/system/perm', icon: <SafetyOutlined />, label: t('menu.systemPerm') },
            ],
          },
        ]
      : []),
  ];

  // 当前选中项与展开项
  const selectedKey = (() => {
    const path = location.pathname;
    if (path.startsWith('/sales/products')) return '/sales/products';
    if (path.startsWith('/sales/leads')) return '/sales/leads';
    if (path.startsWith('/sales/opportunities')) return '/sales/opportunities';
    if (path.startsWith('/sales/orders')) return '/sales/orders';
    if (path.startsWith('/system/')) return path;
    return path;
  })();
  const openKeys = collapsed ? [] : selectedKey.startsWith('/sales') ? ['sales-group'] : selectedKey.startsWith('/system') ? ['system-group'] : [];

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
          onClick={() => navigate('/')}
          style={{ cursor: 'pointer', userSelect: 'none' }}
        >
          <img className="brand-icon" src="/logo.png" alt="Logo" draggable={false} />
          {!collapsed && <span className="brand-text">Joylifetoy</span>}
        </div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={[selectedKey]}
          defaultOpenKeys={['sales-group']}
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
            <span style={{ fontSize: 16, fontWeight: 600, color: token.colorText }}>
              {routeTitles[location.pathname] || 'Joylifetoy'}
            </span>
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
          <span style={{ color: 'rgba(0,0,0,0.65)', fontSize: 14 }}>
            {t('common.loadingRates')}
          </span>
        </div>
      )}
    </Layout>
  );
}
