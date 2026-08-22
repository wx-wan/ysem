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
import ProductGroupsPage from './pages/ProductGroups';
import SalesLeadsPage from './pages/SalesLeads';
import SalesOpportunitiesPage from './pages/SalesOpportunities';
import SalesOrdersPage from './pages/SalesOrders';
import ReportsPage from './pages/Reports';
import OrdersPage from './pages/Orders';
import ProductionPage from './pages/Production';
import ShipmentPage from './pages/Shipment';
import UserPage from './pages/User';
import RolePage from './pages/Role';
import DeptPage from './pages/Dept';
import PermPage from './pages/Perm';
import ProductTaxonomyPage from './pages/ProductTaxonomy';
import CertificatePage from './pages/Certificate';
import OperationLogsPage from './pages/OperationLogs';
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
          <Route path="products" element={<ProductsPage />} />
          <Route path="product-groups" element={<PermRoute perm="sales:products"><ProductGroupsPage /></PermRoute>} />
          <Route path="leads" element={<SalesLeadsPage />} />
          <Route path="opportunities" element={<SalesOpportunitiesPage />} />
          <Route path="orders" element={<SalesOrdersPage />} />
        </Route>
        <Route path="orders" element={<OrdersPage />} />
        <Route path="production" element={<ProductionPage />} />
        <Route path="shipment" element={<ShipmentPage />} />
        <Route path="customers" element={<PermRoute perm="customers"><CustomersPage /></PermRoute>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="system/user" element={<PermRoute perm="system:user"><UserPage /></PermRoute>} />
        <Route path="system/role" element={<PermRoute perm="system:role"><RolePage /></PermRoute>} />
        <Route path="system/dept" element={<PermRoute perm="system:dept"><DeptPage /></PermRoute>} />
        <Route path="system/perm" element={<PermRoute perm="system:perm"><PermPage /></PermRoute>} />
        <Route path="system/product-taxonomy" element={<PermRoute perm="product:taxonomy:view"><ProductTaxonomyPage /></PermRoute>} />
        <Route path="system/certificates" element={<PermRoute perm="certificate:view"><CertificatePage /></PermRoute>} />
        <Route path="system/operation-logs" element={<PermRoute perm="system:perm"><OperationLogsPage /></PermRoute>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
