import { useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, theme, Skeleton } from 'antd';
import { Z_INDEX } from '../zIndex';
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
  ToolOutlined,
  CarOutlined,
  DollarOutlined,
  DatabaseOutlined,
  ContainerOutlined,
  ExperimentOutlined,
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
  '/dashboard': '看板',
  '/sales': '销售',
  '/sales/leads': '线索',
  '/sales/opportunities': '商机',
  '/sales/quotes': '报价',
  '/sales/orders': '订单',
  '/sales/samples': '打样',
  '/supply': '供应',
  '/supply/purchase': '采购',
  '/supply/production': '生产',
  '/supply/inventory': '库存',
  '/logistics': '物流',
  '/logistics/shipment': '出运',
  '/finance': '财务',
  '/finance/settlement': '结算',
  '/data': '数据',
  '/data/customers': '客户',
  '/data/products': '产品',
  '/data/materials': '物料',
  '/data/bom': 'BOM',
  '/data/craft': '工艺',
  '/data/suppliers': '供应商',
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
    // 用户管理承载「用户 / 角色 / 部门」三个分页，因此任一权限即可进入该页
    ...(hasPerm('system:user') || hasPerm('system:role') || hasPerm('system:dept') ? [{ key: '/setting/user', icon: <TeamOutlined />, label: t('menu.systemUser') }] : []),
    ...(hasPerm('system:perm') ? [{ key: '/setting/perm', icon: <SafetyOutlined />, label: t('menu.systemPerm') }] : []),
    ...(hasPerm('product:taxonomy:view') ? [{ key: '/setting/archive', icon: <AppstoreOutlined />, label: t('menu.systemArchive') }] : []),
    ...(hasPerm('system:channel') ? [{ key: '/setting/channel', icon: <ApiOutlined />, label: t('menu.systemChannel') }] : []),
    ...(hasPerm('system:customer-type') ? [{ key: '/setting/customer-type', icon: <TagsOutlined />, label: t('menu.customerType') }] : []),
    ...(hasPerm('system:approval') ? [{ key: '/setting/approval', icon: <NodeIndexOutlined />, label: t('menu.systemApproval') }] : []),
    ...(hasPerm('system:logs') ? [{ key: '/setting/logs', icon: <BarChartOutlined />, label: t('menu.systemLogs') }] : []),
  ];

  // 业务分组菜单（按销售 / 供应 / 物流 / 财务 / 数据 组织）
  const salesChildren = [
    ...(hasPerm('sales:leads') ? [{ key: '/sales/leads', icon: <ProjectOutlined />, label: t('sales.lead') }] : []),
    ...(hasPerm('sales:opportunities') ? [{ key: '/sales/opportunities', icon: <ThunderboltOutlined />, label: t('sales.opportunity') }] : []),
    ...(hasPerm('sales:quotes') ? [{ key: '/sales/quotes', icon: <SolutionOutlined />, label: t('menu.quote') }] : []),
    ...(hasPerm('sales:orders') ? [{ key: '/sales/orders', icon: <ShoppingCartOutlined />, label: t('menu.orders') }] : []),
  ].filter(Boolean);

  const supplyChildren = [
    ...(hasPerm('purchase') ? [{ key: '/supply/purchase', icon: <ShopOutlined />, label: t('menu.purchase') }] : []),
    ...(hasPerm('production') ? [{ key: '/supply/production', icon: <UnorderedListOutlined />, label: t('menu.production') }] : []),
    ...(hasPerm('inventory') ? [{ key: '/supply/inventory', icon: <ContainerOutlined />, label: t('menu.inventory') }] : []),
  ].filter(Boolean);

  const logisticsChildren = [
    ...(hasPerm('shipment') ? [{ key: '/logistics/shipment', icon: <SendOutlined />, label: t('menu.shipment') }] : []),
  ].filter(Boolean);

  const financeChildren = [
    ...(hasPerm('sales:settlement') ? [{ key: '/finance/settlement', icon: <FileDoneOutlined />, label: t('menu.settlement') }] : []),
  ].filter(Boolean);

  const dataChildren = [
    ...(hasPerm('customers') ? [{ key: '/data/customers', icon: <TeamOutlined />, label: t('menu.customers') }] : []),
    ...(hasPerm('products') ? [{ key: '/data/products', icon: <AppstoreOutlined />, label: t('menu.products') }] : []),
    ...(hasPerm('materials') ? [{ key: '/data/materials', icon: <ContainerOutlined />, label: t('menu.materials') }] : []),
    ...(hasPerm('bom') ? [{ key: '/data/bom', icon: <ProfileOutlined />, label: t('menu.bom') }] : []),
    ...(hasPerm('craft') ? [{ key: '/data/craft', icon: <ExperimentOutlined />, label: t('menu.craft') }] : []),
    ...(hasPerm('suppliers') ? [{ key: '/data/suppliers', icon: <TeamOutlined />, label: t('menu.suppliers') }] : []),
  ].filter(Boolean);

  const businessMenuItems: MenuProps['items'] = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: t('menu.dashboard') },
    ...(salesChildren.length ? [{
      key: '/sales',
      icon: <ShoppingCartOutlined />,
      label: t('menu.sales'),
      children: salesChildren,
    }] : []),
    ...(supplyChildren.length ? [{
      key: '/supply',
      icon: <ToolOutlined />,
      label: t('menu.supply'),
      children: supplyChildren,
    }] : []),
    ...(logisticsChildren.length ? [{
      key: '/logistics',
      icon: <CarOutlined />,
      label: t('menu.logistics'),
      children: logisticsChildren,
    }] : []),
    ...(financeChildren.length ? [{
      key: '/finance',
      icon: <DollarOutlined />,
      label: t('menu.finance'),
      children: financeChildren,
    }] : []),
    ...(dataChildren.length ? [{
      key: '/data',
      icon: <DatabaseOutlined />,
      label: t('menu.data'),
      children: dataChildren,
    }] : []),
  ];

  const menuItems = isSettingMode ? settingMenuItems : businessMenuItems;

  // 父级分组 key
  const parentKeys = useMemo(() => ['/sales', '/supply', '/logistics', '/finance', '/data'], []);

  // 当前选中项：叶子路由
  const selectedKey = (() => {
    const path = location.pathname;
    if (path.startsWith('/sales/leads')) return '/sales/leads';
    if (path.startsWith('/sales/opportunities')) return '/sales/opportunities';
    if (path.startsWith('/sales/quotes')) return '/sales/quotes';
    if (path.startsWith('/sales/orders')) return '/sales/orders';
    if (path.startsWith('/sales/samples')) return '/sales/samples';
    if (path.startsWith('/supply/purchase')) return '/supply/purchase';
    if (path.startsWith('/supply/production')) return '/supply/production';
    if (path.startsWith('/supply/inventory')) return '/supply/inventory';
    if (path.startsWith('/logistics/shipment')) return '/logistics/shipment';
    if (path.startsWith('/finance/settlement')) return '/finance/settlement';
    if (path.startsWith('/data/customers')) return '/data/customers';
    if (path.startsWith('/data/products')) return '/data/products';
    if (path.startsWith('/data/materials')) return '/data/materials';
    if (path.startsWith('/data/bom')) return '/data/bom';
    if (path.startsWith('/data/craft')) return '/data/craft';
    if (path.startsWith('/data/suppliers')) return '/data/suppliers';
    return path;
  })();

  // 当前展开项：自动展开所在业务分组
  const [openKeys, setOpenKeys] = useState<string[]>(parentKeys);
  useEffect(() => {
    const activeParent = parentKeys.find((p) => location.pathname.startsWith(p));
    if (activeParent && !openKeys.includes(activeParent)) {
      setOpenKeys((prev) => [...prev, activeParent]);
    }
  }, [location.pathname, openKeys, parentKeys]);

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
          flex: '0 0 232px',
          // 高于内容区/顶部栏、低于浮层，防止 HMR 样式重排时被内容覆盖
          zIndex: 9,
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
          openKeys={openKeys}
          items={menuItems}
          onClick={handleMenuClick}
          onOpenChange={setOpenKeys}
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
            zIndex: Z_INDEX.top,
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
