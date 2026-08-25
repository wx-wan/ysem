import { Routes, Route, Navigate } from 'react-router-dom';
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
import ChannelManagementPage from './pages/ChannelManagement';
import SettingLayout from './layouts/SettingLayout';
import NotFoundPage from './pages/NotFound';
import ForbiddenPage from './pages/Forbidden';

// 路由守卫 — 登录校验
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
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
        <Route index element={<Navigate to="/dashboard" replace />} />
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
        <Route path="customers" element={<PermRoute perm="customers"><CustomersPage /></PermRoute>} />
      </Route>
      {/* 系统设置：独立的一套框架（侧边栏为设置分组菜单，与业务侧边栏区分） */}
      <Route path="/setting" element={<SettingLayout />}>
        <Route path="user" element={<UserManagementPage />} />
        <Route path="perm" element={<PermPage />} />
        <Route path="archive" element={<ProductManagementPage systemOnly />} />
        <Route path="channel" element={<ChannelManagementPage />} />
        <Route path="logs" element={<OperationLogsPage />} />
        <Route path="approval" element={<SettingsApprovalPage />} />
      </Route>
      <Route path="/design" element={<Navigate to="/setting" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
