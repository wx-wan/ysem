import { Alert, Button, Card, Space, Table, Tag, Typography } from 'antd';
import { useEffect } from 'react';
import { useCurrentUser } from '../auth/useCurrentUser';
import { useDataScope } from '../auth/useDataScope';
import { useMasterData } from '../hooks/useMasterData';
import { countChannels } from '../utils/masterData';

const { Title, Text } = Typography;

/**
 * 工作台占位页（Round F-3 §14）+ Master Data 开发验证区（Round F-4 §23）
 *
 * 该验证区**不是业务 UI**：只用于确认 Shared Master Data 数据层可用
 * （各字典条数 / 渠道 ACTIVE 收敛 / 缓存与刷新行为）。
 * F-2 的权限测试区已随其验证完成而移除（权限基础设施全部保留）。
 */
export default function Dashboard() {
  const { user } = useCurrentUser();
  const { dataScope } = useDataScope();
  const master = useMasterData();
  const { loadAll } = master;

  // 进入页面时确保主数据就绪（TTL 内重复进入不会产生新的网络请求）
  useEffect(() => {
    void loadAll().catch(() => {
      // 错误已进入 store.error，由下方 Alert 呈现
    });
  }, [loadAll]);

  const rows = [
    { key: 'customerTypes', label: 'Customer Types', count: master.customerTypes.length, note: 'isActive 由后端过滤' },
    {
      key: 'channels',
      label: 'Channels',
      count: countChannels(master.activeChannels),
      note: `ACTIVE 收敛后（原始 ${countChannels(master.channels)}）`,
    },
    { key: 'countries', label: 'Countries', count: master.countries.length, note: 'string[]' },
    { key: 'certificates', label: 'Certificates', count: master.certificates.length, note: '前端不过滤' },
    { key: 'crafts', label: 'Crafts', count: master.crafts.length, note: 'taxonomy' },
    { key: 'audiences', label: 'Audiences', count: master.audiences.length, note: 'taxonomy' },
    { key: 'categories', label: 'Categories', count: master.categories.length, note: 'taxonomy' },
    { key: 'productOptions', label: 'Product Options', count: master.productOptions.length, note: '可见性由后端过滤' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card title="YSEM Frontend" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Title level={3} style={{ margin: 0 }}>
            Application Shell Ready
          </Title>
          <Text type="secondary">React + TypeScript + Vite + Ant Design + React Router</Text>
        </div>
      </Card>

      <Card title="Current User" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text>
            <Text strong>username：</Text>
            {user?.username ?? '-'}
          </Text>
          <Text>
            <Text strong>realName：</Text>
            {user?.realName ?? '-'}
          </Text>
          <Text>
            <Text strong>role：</Text>
            {user?.role ? `${user.role.name}（${user.role.code}）` : '-'}
          </Text>
          <Text>
            <Text strong>dataScope：</Text>
            {dataScope}
          </Text>
        </div>
      </Card>

      <Card
        title="Master Data Test"
        style={{ maxWidth: 760 }}
        extra={
          <Space>
            <Button size="small" onClick={() => void master.loadAll()}>
              Load
            </Button>
            <Button size="small" onClick={() => void master.refreshAll().catch(() => {})}>
              Refresh
            </Button>
            <Button size="small" onClick={() => master.clear()}>
              Clear
            </Button>
          </Space>
        }
      >
        {/* 不使用 Space 的 direction（antd 6 已弃用）；直接用 flex 列布局 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
          <Space size={8}>
            <Text type="secondary">loading：</Text>
            <Tag color={master.loading ? 'processing' : 'default'}>{String(master.loading)}</Tag>
            <Text type="secondary">sessionUserId：</Text>
            <Tag>{master.sessionUserId ?? 'null'}</Tag>
          </Space>

          {master.error ? <Alert type="error" showIcon message={master.error} /> : null}

          <Table
            size="small"
            pagination={false}
            dataSource={rows}
            columns={[
              { title: 'Dataset', dataIndex: 'label', width: 180 },
              { title: 'Count', dataIndex: 'count', width: 90 },
              { title: 'Note', dataIndex: 'note' },
            ]}
          />

          <Text type="secondary">
            注：owner 候选集未在此列示 —— F-01 已冻结，`/api/users/select` 不是合法的 owner 指派候选源。
          </Text>
        </div>
      </Card>
    </div>
  );
}
