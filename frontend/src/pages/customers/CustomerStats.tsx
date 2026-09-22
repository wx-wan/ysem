import { Card, Space, Statistic, Typography } from 'antd';
import type { CustomerAllStats, CustomerMyStats, CustomerOwnerStat } from '../../types/customer';
import { NO_INTENT_LABEL, STATS_SCOPE_NOTE } from './constants';

const { Text } = Typography;

/**
 * 列表统计（Round F-6 §22-§23）
 *
 * 严格区分两套 stats 形状（F-5）：
 *   · kind='my'  → CustomerMyStats ：total / newCount / oldCount / noOrderCount / keyCount / intentBreakdown
 *   · kind='all' → CustomerAllStats：total / newCount / oldCount / keyCount（**无** noOrderCount、intentBreakdown）
 *     并由 /all 额外附加 ownerStats / publicCount
 * 不伪造缺失字段（/public 无 stats ⇒ 由页面根本不渲染本组件）。
 */
export type CustomerStatsProps =
  | { kind: 'my'; stats: CustomerMyStats }
  | { kind: 'all'; stats: CustomerAllStats; ownerStats: CustomerOwnerStat[]; publicCount: number };

export default function CustomerStats(props: CustomerStatsProps) {
  return (
    <Card size="small">
      <Space size={32} wrap>
        <Statistic title="客户总数" value={props.stats.total} />
        <Statistic title="重点客户" value={props.stats.keyCount} />
        {props.kind === 'my' ? (
          <>
            <Statistic title="无订单" value={props.stats.noOrderCount} />
            <Statistic title="已成交" value={props.stats.newCount + props.stats.oldCount} />
            <Statistic title="新客户" value={props.stats.newCount} />
            <Statistic title="老客户" value={props.stats.oldCount} />
          </>
        ) : (
          <>
            <Statistic title="新客户" value={props.stats.newCount} />
            <Statistic title="老客户" value={props.stats.oldCount} />
            <Statistic title="公海客户" value={props.publicCount} />
            <Statistic title="归属业务员" value={props.ownerStats.length} />
          </>
        )}
      </Space>

      {props.kind === 'my' && props.stats.intentBreakdown.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          {/* D-INTENT v2：口径为「客户意向 = 关联商机最高意向」，不再与 isKeyAccount 绑定 */}
          <Text type="secondary">客户意向分布：</Text>
          <Space size={16} wrap>
            {props.stats.intentBreakdown.map((item) => (
              <Text key={item.level ?? 'no-intent'}>
                {item.level ?? NO_INTENT_LABEL}：{item.count}
              </Text>
            ))}
          </Space>
        </div>
      ) : null}

      {/* IC-FE-6：stats 与 filter 当前非同一口径（后端未统一，DEFERRED/B-2） */}
      <div style={{ marginTop: 12 }}>
        <Text type="secondary">{STATS_SCOPE_NOTE}</Text>
      </div>
    </Card>
  );
}
