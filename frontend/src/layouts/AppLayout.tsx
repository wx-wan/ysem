import { Layout, Typography } from 'antd';
import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import AppHeader from './AppHeader';
import AppMenu from './AppMenu';

const { Sider, Content } = Layout;
const { Text } = Typography;

/**
 * 已认证应用外壳（Round F-3）：
 *   Sider（权限感知菜单） + Header（当前用户 / 登出） + Content（路由 Outlet）
 * Layout 内不包含任何业务 API 调用。
 */
export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} trigger={null} width={220}>
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 600,
            letterSpacing: 1,
          }}
        >
          {collapsed ? 'Y' : 'YSEM'}
        </div>
        <AppMenu />
      </Sider>

      <Layout>
        <AppHeader collapsed={collapsed} onToggleCollapsed={() => setCollapsed((v) => !v)} />
        <Content style={{ padding: 24, background: '#f5f5f5' }}>
          <Outlet />
        </Content>
        <Layout.Footer style={{ textAlign: 'center', padding: '12px 0' }}>
          <Text type="secondary">YSEM Frontend</Text>
        </Layout.Footer>
      </Layout>
    </Layout>
  );
}
