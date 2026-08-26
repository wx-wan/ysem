import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, theme, Skeleton } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  AppstoreOutlined,
  ProjectOutlined,
  ThunderboltOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  UnorderedListOutlined,
  SolutionOutlined,
  ProfileOutlined,
  SendOutlined,
  TeamOutlined,
  FileDoneOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SafetyOutlined,
  ApiOutlined,
  TagsOutlined,
  NodeIndexOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { usePermission } from '../hooks/usePermission';
import { useNotificationStream } from '../stores/useNotification';
import PermChangedModal from '../components/PermChangedModal';
import { authApi } from '../api/auth';
import HeaderTools from './HeaderTools';

const { Sider, Header, Content } = Layout;

// 路由 → 页面名映射
const routeTitles: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/sales/leads': '线索',
  '/customers': '客户',
  '/sales/opportunities': '商机',
  '/sales/products': '产品',
  '/quotes': '报价',
  '/samples': '打样',
  '/orders': '订单',
  '/purchase': '采购',
  '/production': '生产',
  '/shipment': '出货',
  '/settlement': '结算',
  '/system/user': '用户管理',
  '/system/role': '角色管理',
  '/system/dept': '部门管理',
  '/system/perm': '权限管理',
  '/system/product-taxonomy': '产品管理',
  '/system/certificates': '销售管理',
  '/system/operation-logs': '操作日志',
  '/system/approval': '审批管理',
  '/setting/user': '用户管理',
  '/setting/perm': '权限管理',
  '/setting/archive': '产品档案',
  '/setting/channel': '渠道管理',
  '/setting/customer-type': '客户类型',
  '/setting/approval': '审批管理',
  '/setting/logs': '操作日志',
};

export default function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout, ready } = useAuthStore();
  const { fetchRates, loading: ratesLoading } = useCurrencyStore();
  const { token } = theme.useToken();
  // 连接 SSE 通知流：权限变更等实时推送给当前用户
  useNotificationStream();
  // 侧边导航默认展开，仅通过顶部折叠按钮手动控制
  const [collapsed, setCollapsed] = useState(false);

  // 获取用户信息（防 StrictMode 双重挂载重复请求）
  const profileFetched = useRef(false);
  useEffect(() => {
    if (!user && !profileFetched.current) {
      profileFetched.current = true;
      authApi.getProfile().then((res) => {
        const profile = res.data.data;
        // getProfile 返回 role.permissions（嵌套），需提取为顶层 permissions 数组
        const permissions = profile?.role?.permissions?.map((rp: { permission: { code: string } }) => rp.permission.code) ?? [];
        // 只更新 user/permissions，保留 localStorage 中的 token 与过期时间，避免刷新页面后丢失"提前静默刷新"能力
        useAuthStore.getState().setUser({ ...profile, permissions }, permissions);
      }).catch((err: unknown) => {
        // 仅 401（token 真实失效且 refresh 失败）视为未登录；网络错误/后端重启/5xx 保留本地登录态
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401) {
          logout();
          navigate('/login');
        }
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

  const { hasPerm } = usePermission();

  // 是否为设置模式：右上角「设置」进入，点击 logo 返回业务模式
  const isSettingMode = location.pathname.startsWith('/setting');

  // 设置模式侧边栏菜单（按权限动态渲染，扁平展示设置子模块）
  const settingMenuItems: MenuProps['items'] = [
    ...(hasPerm('system:user') ? [{ key: '/setting/user', icon: <TeamOutlined />, label: t('menu.systemUser') }] : []),
    ...(hasPerm('system:role') ? [{ key: '/setting/role', icon: <SafetyOutlined />, label: t('menu.systemRole') }] : []),
    ...(hasPerm('system:perm') ? [{ key: '/setting/perm', icon: <SafetyOutlined />, label: t('menu.systemPerm') }] : []),
    ...(hasPerm('product:taxonomy:view') ? [{ key: '/setting/archive', icon: <AppstoreOutlined />, label: t('menu.systemArchive') }] : []),
    ...(hasPerm('system:channel') ? [{ key: '/setting/channel', icon: <ApiOutlined />, label: t('menu.systemChannel') }] : []),
    ...(hasPerm('system:customer-type') ? [{ key: '/setting/customer-type', icon: <TagsOutlined />, label: t('menu.customerType') }] : []),
    ...(hasPerm('system:approval') ? [{ key: '/setting/approval', icon: <NodeIndexOutlined />, label: t('menu.systemApproval') }] : []),
    ...(hasPerm('system:logs') ? [{ key: '/setting/logs', icon: <BarChartOutlined />, label: t('menu.systemLogs') }] : []),
  ];

  // 业务模式侧边栏菜单（按业务流程顺序扁平化，按权限动态渲染）
  const businessMenuItems: MenuProps['items'] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('menu.dashboard') },
    ...(hasPerm('sales:leads') ? [{ key: '/sales/leads', icon: <ProjectOutlined />, label: t('sales.lead') }] : []),
    // 客户：需要 customers 权限（所有默认角色均已分配）
    ...(hasPerm('customers') ? [{ key: '/customers', icon: <TeamOutlined />, label: t('menu.customers') }] : []),
    ...(hasPerm('sales:opportunities') ? [{ key: '/sales/opportunities', icon: <ThunderboltOutlined />, label: t('sales.opportunity') }] : []),
    ...(hasPerm('sales:products') ? [{ key: '/sales/products', icon: <AppstoreOutlined />, label: t('menu.products') }] : []),
    ...(hasPerm('sales:quotes') ? [{ key: '/quotes', icon: <SolutionOutlined />, label: t('menu.quote') }] : []),
    ...(hasPerm('sales:samples') ? [{ key: '/samples', icon: <ProfileOutlined />, label: t('menu.sample') }] : []),
    ...(hasPerm('orders') ? [{ key: '/orders', icon: <ShoppingCartOutlined />, label: t('menu.orders') }] : []),
    ...(hasPerm('purchase') ? [{ key: '/purchase', icon: <ShopOutlined />, label: t('menu.purchase') }] : []),
    ...(hasPerm('production') ? [{ key: '/production', icon: <UnorderedListOutlined />, label: t('menu.production') }] : []),
    ...(hasPerm('shipment') ? [{ key: '/shipment', icon: <SendOutlined />, label: t('menu.shipment') }] : []),
    ...(hasPerm('sales:settlement') ? [{ key: '/settlement', icon: <FileDoneOutlined />, label: t('menu.settlement') }] : []),
  ];

  const menuItems = isSettingMode ? settingMenuItems : businessMenuItems;

  // 当前选中项与展开项
  const selectedKey = (() => {
    const path = location.pathname;
    if (path.startsWith('/sales/products')) return '/sales/products';
    if (path.startsWith('/sales/leads')) return '/sales/leads';
    if (path.startsWith('/sales/opportunities')) return '/sales/opportunities';
    if (path.startsWith('/quotes')) return '/quotes';
    if (path.startsWith('/samples')) return '/samples';
    if (path.startsWith('/settlement')) return '/settlement';
    return path;
  })();

  // 用户/权限未就绪时显示骨架屏过渡，避免首屏重渲染闪烁
  if (!ready) {
    return (
      <Layout style={{ minHeight: '100vh', background: token.colorBgLayout }}>
        <Sider
          theme="light"
          width={232}
          style={{
            borderRight: `1px solid ${token.colorBorderSecondary}`,
            position: 'sticky',
            top: 0,
            height: '100vh',
          }}
        >
          <div className="sider-brand" style={{ padding: '16px 20px' }}>
            <Skeleton.Avatar active size={28} style={{ marginRight: 10 }} />
            <Skeleton.Input active size="small" style={{ width: 120 }} />
          </div>
          <Skeleton active title={false} paragraph={{ rows: 8 }} style={{ padding: '0 16px' }} />
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
            }}
          >
            <Skeleton.Input active size="small" style={{ width: 120 }} />
            <Skeleton.Avatar active size={28} />
          </Header>
          <Content className="page-container" style={{ padding: 20 }}>
            <Skeleton active paragraph={{ rows: 10 }} />
          </Content>
        </Layout>
      </Layout>
    );
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
          defaultOpenKeys={[]}
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

      {/* 权限/数据范围变更确认刷新弹窗（自定义 AppModal，禁止关闭，仅可立即刷新） */}
      <PermChangedModal />
    </Layout>
  );
}
