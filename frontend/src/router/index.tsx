import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from '../components/RequireAuth';
import AppLayout from '../layouts/AppLayout';
import CustomerDetailPage from '../pages/customers/CustomerDetailPage';
import CustomerListPage from '../pages/customers/CustomerListPage';
import Dashboard from '../pages/Dashboard';
import Login from '../pages/Login';
import NotFound from '../pages/NotFound';
import Placeholder from '../pages/Placeholder';
import ProductListPage from '../pages/products/ProductListPage';
import { APP_MENU, collectMenuPaths } from './menu';

/**
 * 路由表（Round F-3 / F-3.1）：
 *   /login  —— 不使用 AppLayout
 *   其余    —— RequireAuth → AppLayout（Sider + Header + Content/Outlet）
 *
 * 占位路由由菜单定义派生（含 F-3.1 的前端路由映射：system:user/role/dept →
 * /setting/user、/setting/role、/setting/department），保证「菜单 path ↔ 前端路由」同源。
 * 本轮不实现任何业务页面。`*` 置于认证外壳内：未登录访问未知路径 → /login，
 * 已登录 → 外壳内 404（真正不存在的 /setting/not-exist 亦然）。
 */
export default function AppRoutes() {
  // /dashboard、/data/customers 与 /data/products 已有真实页面，其余菜单 path 仍用占位页
  const implementedRoutes = ['/dashboard', '/data/customers', '/data/products'];
  const placeholderRoutes = collectMenuPaths(APP_MENU).filter((r) => !implementedRoutes.includes(r.path));

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />

        {/* F-6：客户列表；F-7：客户详情（均为真实页面，详情只读） */}
        <Route path="data/customers" element={<CustomerListPage />} />
        <Route path="data/customers/:id" element={<CustomerDetailPage />} />

        {/* F-S1：产品 MVP（列表 + 新建/编辑；路由 path 与菜单 product-center.products 同源） */}
        <Route path="data/products" element={<ProductListPage />} />

        {placeholderRoutes.map((r) => (
          <Route
            key={r.path}
            path={r.path.replace(/^\//, '')}
            element={<Placeholder title={r.label} group={r.group} />}
          />
        ))}

        {/* 嵌套子路由：验证「深层 pathname 仍高亮父级菜单」 */}
        <Route path="data/customers/:id" element={<Placeholder title="客户详情" />} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
