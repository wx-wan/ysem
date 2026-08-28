import { Routes, Route, Navigate } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import { useAuthStore } from './stores/useAuthStore';
import { usePermission } from './hooks/usePermission';
import { setMessageHolder } from './api/message-holder';
import MainLayout from './layouts/MainLayout';
import GroupLayout from './layouts/GroupLayout';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import SalesPage from './pages/Sales';
import CustomersPage from './pages/Customers';
import SalesLayout from './layouts/SalesLayout';
import ProductsPage from './pages/Products';
import ProductManagementPage from './pages/ProductManagement';
import SalesLeadsPage from './pages/SalesLeads';
import SalesOpportunitiesPage from './pages/SalesOpportunities';
import SalesOrdersPage from './pages/SalesOrders';
import QuotePage from './pages/QuotePage';
import SamplePage from './pages/SamplePage';
import SettlementPage from './pages/SettlementPage';
import OrdersPage from './pages/Orders';
import PurchasesPage from './pages/Purchases';
import ProductionPage from './pages/Production';
import ShipmentPage from './pages/Shipment';
import InventoryPage from './pages/Inventory';
import MaterialsPage from './pages/Materials';
import BomPage from './pages/Bom';
import CraftPage from './pages/Craft';
import SuppliersPage from './pages/Suppliers';
import UserManagementPage from './pages/UserManagement';
import PermPage from './pages/Perm';
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
  return <Navigate to={first ? first[1] : '/setting/user'} replace />;
}

// 路由守卫 — 登录校验
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// 路由守卫 — 权限校验（按页面所需的 permission code）
function PermRoute({ perm, children }: { perm: string | string[]; children: React.ReactNode }) {
  const { hasAnyPerm } = usePermission();
  const ok = Array.isArray(perm) ? hasAnyPerm(perm) : hasAnyPerm([perm]);
  if (!ok) return <ForbiddenPage />;
  return <>{children}</>;
}

function App() {
  const { message } = AntdApp.useApp();
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

        {/* 销售：线索 / 商机 / 报价 / 订单（ optionally 打样保留但不进导航） */}
        <Route path="sales" element={<SalesLayout />}>
          <Route index element={<PermRoute perm="sales"><SalesPage /></PermRoute>} />
          <Route path="leads" element={<PermRoute perm="sales:leads"><SalesLeadsPage /></PermRoute>} />
          <Route path="opportunities" element={<PermRoute perm="sales:opportunities"><SalesOpportunitiesPage /></PermRoute>} />
          <Route path="quotes" element={<PermRoute perm="sales:quotes"><QuotePage /></PermRoute>} />
          <Route path="orders" element={<PermRoute perm="sales:orders"><SalesOrdersPage /></PermRoute>} />
          <Route path="samples" element={<PermRoute perm="sales:samples"><SamplePage /></PermRoute>} />
        </Route>

        {/* 供应：采购 / 生产 / 库存 */}
        <Route path="supply" element={<GroupLayout />}>
          <Route index element={<Navigate to="/supply/purchase" replace />} />
          <Route path="purchase" element={<PermRoute perm="purchase"><PurchasesPage /></PermRoute>} />
          <Route path="production" element={<PermRoute perm="production"><ProductionPage /></PermRoute>} />
          <Route path="inventory" element={<PermRoute perm="inventory"><InventoryPage /></PermRoute>} />
        </Route>

        {/* 物流：出运 */}
        <Route path="logistics" element={<GroupLayout />}>
          <Route index element={<Navigate to="/logistics/shipment" replace />} />
          <Route path="shipment" element={<PermRoute perm="shipment"><ShipmentPage /></PermRoute>} />
        </Route>

        {/* 财务：结算 */}
        <Route path="finance" element={<GroupLayout />}>
          <Route index element={<Navigate to="/finance/settlement" replace />} />
          <Route path="settlement" element={<PermRoute perm="sales:settlement"><SettlementPage /></PermRoute>} />
        </Route>

        {/* 数据：客户 / 产品 / 物料 / BOM / 工艺 / 供应商 */}
        <Route path="data" element={<GroupLayout />}>
          <Route index element={<Navigate to="/data/customers" replace />} />
          <Route path="customers" element={<PermRoute perm="customers"><CustomersPage /></PermRoute>} />
          <Route path="products" element={<PermRoute perm="products"><ProductsPage /></PermRoute>} />
          <Route path="materials" element={<PermRoute perm="materials"><MaterialsPage /></PermRoute>} />
          <Route path="bom" element={<PermRoute perm="bom"><BomPage /></PermRoute>} />
          <Route path="craft" element={<PermRoute perm="craft"><CraftPage /></PermRoute>} />
          <Route path="suppliers" element={<PermRoute perm="suppliers"><SuppliersPage /></PermRoute>} />
        </Route>

        {/* 保留旧路径兼容性（访问 /orders、/quotes 等自动跳转到 /sales/xxx） */}
        <Route path="orders" element={<Navigate to="/sales/orders" replace />} />
        <Route path="quotes" element={<Navigate to="/sales/quotes" replace />} />
        <Route path="samples" element={<Navigate to="/sales/samples" replace />} />
        <Route path="purchase" element={<Navigate to="/supply/purchase" replace />} />
        <Route path="production" element={<Navigate to="/supply/production" replace />} />
        <Route path="shipment" element={<Navigate to="/logistics/shipment" replace />} />
        <Route path="settlement" element={<Navigate to="/finance/settlement" replace />} />
        <Route path="customers" element={<Navigate to="/data/customers" replace />} />
        <Route path="products" element={<Navigate to="/data/products" replace />} />

        {/* 系统设置：并入主布局，切换仅重绘内容区，不重挂整体布局 */}
        <Route path="setting">
          <Route index element={<SettingIndex />} />
          <Route path="user" element={<PermRoute perm={['system:user', 'system:role', 'system:dept']}><UserManagementPage /></PermRoute>} />
          <Route path="perm" element={<PermRoute perm="system:perm"><PermPage /></PermRoute>} />
          <Route path="archive" element={<PermRoute perm="product:taxonomy:view"><ProductManagementPage systemOnly /></PermRoute>} />
          <Route path="channel" element={<PermRoute perm="system:channel"><ChannelManagementPage /></PermRoute>} />
          <Route path="logs" element={<PermRoute perm="system:logs"><OperationLogsPage /></PermRoute>} />
          <Route path="approval" element={<PermRoute perm="system:approval"><SettingsApprovalPage /></PermRoute>} />
          <Route path="customer-type" element={<PermRoute perm="system:customer-type"><SettingsCustomerTypePage /></PermRoute>} />
        </Route>
      </Route>
      <Route path="/design" element={<Navigate to="/setting" />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export default App;
