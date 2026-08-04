import { useEffect, useMemo, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Spin, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { authApi } from '../api/auth';
import HeaderTools from './HeaderTools';

const { Header, Content } = Layout;

// 路由 → 页面名映射
const routeTitles: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/sales': '销售管理',
  '/orders': '订单管理',
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
  const { token: { colorBgContainer } } = theme.useToken();

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

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key.startsWith('/')) navigate(key);
  };

  const navItems = [
    { key: '/dashboard', label: t('menu.dashboard') },
    { key: '/sales', label: t('menu.sales') },
    { key: '/orders', label: t('menu.orders') },
    { key: '/production', label: t('menu.production') },
    { key: '/shipment', label: t('menu.shipment') },
    { key: '/customers', label: t('menu.customers') },
    { key: '/reports', label: t('menu.reports') },
  ];

  // ==================== 角色权限配置 ====================
  const allowedNavKeys: Record<string, string[]> = {
    admin: ['/dashboard', '/sales', '/orders', '/production', '/shipment', '/customers', '/reports'],
    business: ['/dashboard', '/sales', '/orders', '/production', '/shipment', '/customers', '/reports'],
    user: ['/dashboard', '/sales', '/orders', '/production', '/shipment', '/customers', '/reports'],
  };

  const roleCode = user?.role?.code || 'user';
  const visibleNavKeys = allowedNavKeys[roleCode] || allowedNavKeys.user;
  const visibleNavItems = navItems.filter((item) => visibleNavKeys.includes(item.key));

  const activePath = location.pathname;

  return (
    <Layout className="main-layout horizontal">
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
      <Header className="top-header" style={{ background: colorBgContainer }}>
        {/* 左侧品牌 */}
        <div className="header-brand" onClick={() => navigate('/')}>
          <img className="brand-icon" src="/logo.png" alt="Logo" draggable={false} />
          <span className="brand-text">Joylifetoy</span>
        </div>

        {/* 中间导航 */}
        <nav className="header-nav">
          {visibleNavItems.map((item) => (
            <div
              key={item.key}
              className={`nav-item ${activePath === item.key || activePath.startsWith(item.key) ? 'active' : ''}`}
              onClick={() => navigate(item.key)}
            >
              {item.label}
            </div>
          ))}
        </nav>

        {/* 右侧工具区 */}
        <HeaderTools user={user} onLogout={handleLogout} onMenuClick={handleMenuClick} />
      </Header>

      <Content className="page-container">
        <Outlet />
      </Content>
    </Layout>
  );
}
