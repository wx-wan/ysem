import { App, Avatar, Button, Dropdown, Layout, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser } from '../auth/useCurrentUser';
import { useAuthStore } from '../stores/useAuthStore';

const { Header } = Layout;
const { Text } = Typography;

interface AppHeaderProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * 顶栏：折叠开关 + 当前用户（realName / role）+ 登出。
 * 当前用户**唯一来源** = useCurrentUser()（→ Auth Store → GET /api/auth/profile）。
 * 不读取、不展示任何 token / JWT / Authorization / password。
 * 说明：刻意不使用图标库（@ant-design/icons 是本工程未声明的间接依赖）。
 */
export default function AppHeader({ collapsed, onToggleCollapsed }: AppHeaderProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = async () => {
    try {
      // 复用 F-1 已实现的 logout（POST /api/auth/logout → clear → 守卫跳转）
      await logout();
      message.success('已退出登录');
    } catch {
      // logout 内部已保证本地状态清理，此处仅提示
      message.error('退出登录失败');
    }
    navigate('/login', { replace: true });
  };

  return (
    <Header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
      }}
    >
      <Space size={12}>
        <Button
          type="text"
          aria-label="collapse-toggle"
          data-collapsed={collapsed ? 'true' : 'false'}
          onClick={onToggleCollapsed}
        >
          {collapsed ? '展开' : '折叠'}
        </Button>
        <Text strong>YSEM</Text>
      </Space>

      <Space size={12}>
        <Dropdown
          menu={{
            items: [
              {
                key: 'identity',
                label: user?.role ? `${user.role.name}（${user.role.code}）` : '未分配角色',
                disabled: true,
              },
              { type: 'divider' as const },
              { key: 'logout', label: '退出登录' },
            ],
            onClick: ({ key }) => {
              if (key === 'logout') void handleLogout();
            },
          }}
        >
          <Space size={8} style={{ cursor: 'pointer' }}>
            <Avatar size={28}>{(user?.realName || user?.username || '?').charAt(0)}</Avatar>
            <Text>{user?.realName ?? user?.username ?? '-'}</Text>
            <Tag>{user?.role?.name ?? '-'}</Tag>
          </Space>
        </Dropdown>

        <Button onClick={handleLogout}>Logout</Button>
      </Space>
    </Header>
  );
}
