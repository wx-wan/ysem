import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/useAuthStore';
import MainLayout from './layouts/MainLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import SalesPage from './pages/Sales';
import CustomersPage from './pages/Customers';
import ReportsPage from './pages/Reports';
import OrdersPage from './pages/Orders';
import UserPage from './pages/User';
import RolePage from './pages/Role';
import DeptPage from './pages/Dept';
import PermPage from './pages/Perm';
import NotFoundPage from './pages/NotFound';

// 路由守卫 — 登录校验
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// 路由守卫 — 角色校验（仅 admin 可访问系统管理）
function AdminRoute({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role?.code);
  if (role !== 'admin') return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function App() {
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
        <Route path="sales" element={<SalesPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="system/user" element={<AdminRoute><UserPage /></AdminRoute>} />
        <Route path="system/role" element={<AdminRoute><RolePage /></AdminRoute>} />
        <Route path="system/dept" element={<AdminRoute><DeptPage /></AdminRoute>} />
        <Route path="system/perm" element={<AdminRoute><PermPage /></AdminRoute>} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
