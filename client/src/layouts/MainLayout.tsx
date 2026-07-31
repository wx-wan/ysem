import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Avatar, Dropdown, Badge, theme } from 'antd';
import {
  SettingOutlined,
  UserOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  BellOutlined,
  TranslationOutlined,
  DollarOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore, CURRENCIES } from '../stores/useCurrencyStore';
import { authApi } from '../api/auth';

const { Header, Content } = Layout;

export default function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { currency, fetchRates, getRateToCNY } = useCurrencyStore();
  const rateToCNY = getRateToCNY();
  const { token: { colorBgContainer } } = theme.useToken();

  const currentLang = i18n.language;

  // 获取用户信息
  useEffect(() => {
    if (!user) {
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

  const handleLogout = () => {
    authApi.logout().finally(() => {
      logout();
      navigate('/login');
    });
  };

  const toggleLanguage = () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(nextLang);
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') handleLogout();
    else if (key.startsWith('/')) navigate(key);
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

  // 系统管理仅 admin 可见
  const hasSystemAccess = roleCode === 'admin';

  const avatarMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('header.profile'),
      onClick: () => navigate('/profile'),
    },
    {
      key: 'password',
      icon: <KeyOutlined />,
      label: t('header.changePassword'),
    },
    ...(hasSystemAccess
      ? [
          {
            key: 'system',
            icon: <SettingOutlined />,
            label: t('menu.system'),
            children: [
              { key: '/system/user', icon: <UserOutlined />, label: t('menu.systemUser') },
              { key: '/system/role', icon: <TeamOutlined />, label: t('menu.systemRole') },
              { key: '/system/dept', icon: <ApartmentOutlined />, label: t('menu.systemDept') },
              { key: '/system/perm', icon: <SafetyOutlined />, label: t('menu.systemPerm') },
            ],
          } as const,
        ]
      : []),
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('header.logout'),
      danger: true,
      onClick: handleLogout,
    },
  ];

  const activePath = location.pathname;

  return (
    <Layout className="main-layout horizontal">
      <Header className="top-header" style={{ background: colorBgContainer }}>
        {/* 左侧品牌 */}
        <div className="header-brand" onClick={() => navigate('/')}>
          <div className="logo-placeholder" />
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
        <div className="header-tools">
          <Badge dot>
            <BellOutlined className="tool-icon" />
          </Badge>

          <div className="lang-switch" onClick={toggleLanguage}>
            <TranslationOutlined />
            <span>{currentLang === 'zh' ? 'EN' : '中文'}</span>
          </div>

          <Dropdown
            menu={{
              items: CURRENCIES.map((c) => ({
                key: c.code,
                label: (
                  <span>
                    <span style={{ marginRight: 8 }}>{c.symbol}</span>
                    {c.code} — {currentLang === 'zh' ? c.labelZh : c.label}
                  </span>
                ),
              })),
              selectedKeys: [currency.code],
              onClick: ({ key }) => useCurrencyStore.getState().setCurrency(key),
            }}
            placement="bottomRight"
          >
            <div className="lang-switch currency-switch">
              <DollarOutlined />
              <span>{currency.code}</span>
            </div>
          </Dropdown>

          {rateToCNY && (
            <span className="exchange-rate-display">{rateToCNY}</span>
          )}

          <Dropdown
            menu={{
              items: avatarMenuItems,
              onClick: handleMenuClick,
            }}
            placement="bottomRight"
          >
            <div className="user-avatar">
              <Avatar icon={<UserOutlined />} size="small" />
              <div className="user-info">
                <span className="user-name">{user?.realName || user?.username || t('common.noData')}</span>
                <span className="user-role">{user?.role?.name || t('menu.systemUser')}</span>
              </div>
            </div>
          </Dropdown>
        </div>
      </Header>

      <Content className="page-container">
        <Outlet />
      </Content>
    </Layout>
  );
}
