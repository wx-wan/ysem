import { Button, Empty, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { OpportunityItem, OpportunityListItem } from '../../../types/sales';
import { formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import {
  INTENT_LEVEL_COLOR,
  INTENT_LEVEL_LABEL,
  OPPORTUNITY_INTENT_LABEL,
  OPPORTUNITY_OUTCOME_COLOR,
  OPPORTUNITY_OUTCOME_LABEL,
  STAGE_COLOR,
  STAGE_LABEL,
} from './constants';

const { Text } = Typography;

export interface OpportunityTableProps {
  rows: OpportunityListItem[];
  loading: boolean;
  onEdit: (opportunity: OpportunityListItem) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/**
 * 商机列表表格（Round F-S2）
 *
 * 列全部来自 OpportunityListItem 真实字段（OPPORTUNITY_INCLUDE 投影 + 派生 stage）：
 *   商机编号 · 标题 · 客户 · 产品（items 摘要）· 商机意向 · 预计金额 · 阶段（派生）· 结论 · 负责人 · 创建时间 · 操作
 *
 * 说明：
 *   · 不存在「商机金额」这类合成字段 —— 金额取自单列 `estimatedAmount`（Decimal → string，不做 Number() 转换）；
 *   · 「阶段」为**派生值**（后端按关联单据推导），不是可写字段；
 *   · 产品明细中关联产品不可见时，后端已把 `product` 与 `productName` 置 null（DQ-3=C）⇒ 显示为「—」。
 */
const summarizeItems = (items: OpportunityItem[]): string => {
  if (items.length === 0) return '-';
  const first = items[0];
  const name = first.product?.name ?? first.productName ?? '（产品不可见）';
  return items.length > 1 ? `${name} 等 ${items.length} 项` : name;
};

export default function OpportunityTable({ rows, loading, onEdit, pagination }: OpportunityTableProps) {
  const columns: ColumnsType<OpportunityListItem> = [
    { title: '商机编号', dataIndex: 'opportunityNo', width: 160, render: (v: string) => textOrDash(v) },
    {
      title: '商机名称',
      dataIndex: 'title',
      ellipsis: true,
      render: (value: string, row) => (
        <Link to={`/sales/opportunities/${row.id}`}>
          <Text strong>{textOrDash(value)}</Text>
        </Link>
      ),
    },
    {
      title: '客户',
      key: 'customer',
      width: 220,
      ellipsis: true,
      render: (_: unknown, row) => (
        <Link to={`/data/customers/${row.customer.id}`}>{textOrDash(row.customer.companyName)}</Link>
      ),
    },
    {
      title: '产品',
      key: 'items',
      width: 200,
      ellipsis: true,
      render: (_: unknown, row) => textOrDash(summarizeItems(row.items)),
    },
    {
      title: OPPORTUNITY_INTENT_LABEL,
      dataIndex: 'intentLevel',
      width: 100,
      render: (value: string | null) =>
        value ? (
          <Tag color={INTENT_LEVEL_COLOR[value] ?? 'default'}>{INTENT_LEVEL_LABEL[value] ?? value}</Tag>
        ) : (
          '-'
        ),
    },
    {
      title: '预计金额',
      key: 'estimatedAmount',
      width: 150,
      align: 'right',
      render: (_: unknown, row) =>
        row.estimatedAmount === null ? '-' : `${row.currency} ${formatDecimalString(row.estimatedAmount)}`,
    },
    {
      title: '阶段',
      dataIndex: 'stage',
      width: 100,
      render: (value: string) => (
        <Tag color={STAGE_COLOR[value as keyof typeof STAGE_COLOR] ?? 'default'}>
          {STAGE_LABEL[value as keyof typeof STAGE_LABEL] ?? value}
        </Tag>
      ),
    },
    {
      title: '结论',
      dataIndex: 'outcome',
      width: 90,
      render: (value: string) => (
        <Tag color={OPPORTUNITY_OUTCOME_COLOR[value] ?? 'default'}>{OPPORTUNITY_OUTCOME_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '负责人',
      key: 'owner',
      width: 110,
      render: (_: unknown, row) =>
        row.owner?.realName ? row.owner.realName : <Text type="secondary">未分配</Text>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => onEdit(row)}>
            编辑
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Table<OpportunityListItem>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无商机" /> }}
      pagination={{
        current: pagination.current,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true,
        pageSizeOptions: [20, 50, 100],
        showTotal: (total) => `共 ${total} 条`,
        onChange: pagination.onChange,
      }}
    />
  );
}
