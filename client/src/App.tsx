import { Routes, Route } from 'react-router-dom';
import SyncNavigate from './components/SyncNavigate';
import { App as AntdApp } from 'antd';
import { useAuthStore } from './stores/useAuthStore';
import { usePermission } from './hooks/usePermission';
import { setMessageHolder } from './api/message-holder';
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import SalesPage from './pages/Sales';
import CustomersPage from './pages/Customers';
import SalesLayout from './layouts/SalesLayout';
import ProductsPage from './pages/Products';
import SalesLeadsPage from './pages/SalesLeads';
import SalesOpportunitiesPage from './pages/SalesOpportunities';
import SalesOrdersPage from './pages/SalesOrders';
import QuotePage from './pages/QuotePage';
import SamplePage from './pages/SamplePage';
import SettlementPage from './pages/SettlementPage';
import OrdersPage from './pages/Orders';
import ProductionPage from './pages/Production';
import ShipmentPage from './pages/Shipment';
import UserManagementPage from './pages/UserManagement';
import PermPage from './pages/Perm';
import ProductManagementPage from './pages/ProductManagement';
import OperationLogsPage from './pages/OperationLogs';
import SettingsApprovalPage from './pages/SettingsApproval';
import SettingsCustomerTypePage from './pages/SettingsCustomerType';
import ChannelManagementPage from './pages/ChannelManagement';
import NotFoundPage from './pages/NotFound';
import ForbiddenPage from './pages/Forbidden';

// 系统设置默认页：按权限跳转到第一个可访问的设置子模块
function SettingIndex() {
  const { hasPerm } = usePermission();
  const first = [
    ['system:user', '/setting/user'],
    ['system:perm', '/setting/perm'],
    ['product:taxonomy:view', '/setting/archive'],
    ['system:channel', '/setting/channel'],
    ['system:customer-type', '/setting/customer-type'],
    ['system:approval', '/setting/approval'],
    ['system:logs', '/setting/logs'],
  ].find(([perm]) => hasPerm(perm));
  return <SyncNavigate to={first ? first[1] : '/setting/user'} />;
}

// 路由守卫 — 登录校验
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <SyncNavigate to="/login" />;
  return <>{children}</>;
}

// 路由守卫 — 权限校验（按页面所需的 permission code）
// 无权限时展示无权限页，而不是静默重定向
function PermRoute({ perm, children }: { perm: string; children: React.ReactNode }) {
  const { hasPerm } = usePermission();
  if (!hasPerm(perm)) return <ForbiddenPage />;
  return <>{children}</>;
}

function App() {
  const { message } = AntdApp.useApp();
  // 注入 App.useApp() 的 message 实例，消除静态调用警告
  setMessageHolder(message);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <PrivateRoute>
            <MainLayout />
          </PrivateRoute>
        }
      >
        <Route index element={<SyncNavigate to="/dashboard" />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sales" element={<SalesLayout />}>
          <Route index element={<SalesPage />} />
          <Route path="products" element={<ProductManagementPage />} />
          <Route path="leads" element={<SalesLeadsPage />} />
          <Route path="opportunities" element={<SalesOpportunitiesPage />} />
          <Route path="orders" element={<SalesOrdersPage />} />
        </Route>
        <Route path="orders" element={<OrdersPage />} />
        <Route path="quotes" element={<PermRoute perm="sales:orders"><QuotePage /></PermRoute>} />
        <Route path="samples" element={<PermRoute perm="sales:orders"><SamplePage /></PermRoute>} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="shipment" element={<ShipmentPage />} />
        <Route path="settlement" element={<PermRoute perm="sales:orders"><SettlementPage /></PermRoute>} />
        <Route path="customers" element={<CustomersPage />} />
        {/* 系统设置：并入主布局，切换仅重绘内容区，不重挂整体布局 */}
        <Route path="setting">
          <Route index element={<SettingIndex />} />
          <Route path="user" element={<PermRoute perm="system:user"><UserManagementPage /></PermRoute>} />
          <Route path="perm" element={<PermRoute perm="system:perm"><PermPage /></PermRoute>} />
          <Route path="archive" element={<PermRoute perm="product:taxonomy:view"><ProductManagementPage systemOnly /></PermRoute>} />
          <Route path="channel" element={<PermRoute perm="system:channel"><ChannelManagementPage /></PermRoute>} />
          <Route path="logs" element={<PermRoute perm="system:logs"><OperationLogsPage /></PermRoute>} />
          <Route path="approval" element={<PermRoute perm="system:approval"><SettingsApprovalPage /></PermRoute>} />
          <Route path="customer-type" element={<PermRoute perm="system:customer-type"><SettingsCustomerTypePage /></PermRoute>} />
        </Route>
      </Route>
      <Route path="/design" element={<SyncNavigate to="/setting" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
