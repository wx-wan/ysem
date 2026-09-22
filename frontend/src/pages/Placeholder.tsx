import { Card, Typography } from 'antd';
import { useLocation } from 'react-router-dom';

const { Title, Text } = Typography;

/**
 * 通用占位页（Round F-3 §13 / F-3.1 §5）：
 * 显示「父级菜单 / 当前页面 / 当前路由」，用于验证「菜单 → router → Outlet → 页面」链路。
 * 本轮不实现任何业务 UI。
 */
export default function Placeholder({ title, group }: { title?: string; group?: string }) {
  const location = useLocation();

  return (
    <Card title={group ? `${group} / ${title ?? 'Page'}` : (title ?? 'Page')} style={{ maxWidth: 720 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          {title ?? 'Page'}
        </Title>
        <Text type="secondary">Coming Soon</Text>
        <Text type="secondary">
          Current route：<Text code>{location.pathname}</Text>
        </Text>
      </div>
    </Card>
  );
}
