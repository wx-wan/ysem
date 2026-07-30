import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Button, theme } from 'antd';
import {
  DashboardOutlined,
  SettingOutlined,
  UserOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../stores/useAuthStore';
import { authApi } from '../api/auth';

const { Header, Sider, Content } = Layout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '仪表盘' },
  {
    key: '/system',
    icon: <SettingOutlined />,
    label: '系统管理',
    children: [
      { key: '/system/user', icon: <UserOutlined />, label: '用户管理' },
      { key: '/system/role', icon: <TeamOutlined />, label: '角色管理' },
      { key: '/system/dept', icon: <ApartmentOutlined />, label: '部门管理' },
      { key: '/system/perm', icon: <SafetyOutlined />, label: '权限管理' },
    ],
  },
];

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { token: { colorBgContainer } } = theme.useToken();

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

  const handleMenuClick = ({ key }: { key: string }) => {
    navigate(key);
  };

  const handleLogout = () => {
    authApi.logout().finally(() => {
      logout();
      navigate('/login');
    });
  };

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: '个人信息' },
    { key: 'password', icon: <KeyOutlined />, label: '修改密码' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const handleUserMenuClick = ({ key }: { key: string }) => {
    if (key === 'logout') handleLogout();
  };

  const openKeys = ['/system'];

  return (
    <Layout className="main-layout">
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        breakpoint="lg"
        width={220}
      >
        <div className={`logo ${collapsed ? 'logo-collapsed' : ''}`}>
          {collapsed ? '寿春' : '义乌寿春企业管理'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname]}
          defaultOpenKeys={openKeys}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>

      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', alignItems: 'center' }}>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: 16, width: 48, height: 48 }}
          />
          <div className="header-right">
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenuClick }} placement="bottomRight">
              <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar icon={<UserOutlined />} />
                <span>{user?.realName || '用户'}</span>
              </div>
            </Dropdown>
          </div>
        </Header>

        <Content className="page-container">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
