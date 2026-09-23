import { Button, Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { QuotationListItem } from '../../../types/quotation';
import { formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import { QUOTATION_STATUS_COLOR, QUOTATION_STATUS_LABEL } from './constants';

const { Text } = Typography;

export interface QuotationTableProps {
  rows: QuotationListItem[];
  loading: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/**
 * 报价列表表格（Round F-S3）
 *
 * 列全部来自 QuotationListItem 真实字段（QUOTATION_INCLUDE 投影）：
 *   报价编号 · 标题 · 客户 · 商机 · 版本 · 金额 · 状态 · 创建时间 · 操作
 *
 * 说明：
 *   · 金额 = 后端 `totalAmount`（Decimal → string）+ `currency`，**不做任何前端计算**；
 *   · 状态为**只读展示**（Tag），不提供流转入口；
 *   · **不展示负责人**：QUOTATION_INCLUDE 无 owner 投影（F-01 冻结 owner 候选源，前端不做补查）。
 */
export default function QuotationTable({ rows, loading, pagination }: QuotationTableProps) {
  const columns: ColumnsType<QuotationListItem> = [
    { title: '报价编号', dataIndex: 'quotationNo', width: 165, render: (v: string) => textOrDash(v) },
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
      render: (value: string, row) => (
        <Link to={`/sales/quotes/${row.id}`}>
          <Text strong>{textOrDash(value)}</Text>
        </Link>
      ),
    },
    {
      title: '客户',
      key: 'customer',
      width: 200,
      ellipsis: true,
      render: (_: unknown, row) => (
        <Link to={`/data/customers/${row.customer.id}`}>{textOrDash(row.customer.companyName)}</Link>
      ),
    },
    {
      title: '商机',
      key: 'opportunity',
      width: 200,
      ellipsis: true,
      render: (_: unknown, row) => (
        <Link to={`/sales/opportunities/${row.opportunity.id}`}>{textOrDash(row.opportunity.title)}</Link>
      ),
    },
    { title: '版本', dataIndex: 'version', width: 70, align: 'right', render: (v: number) => `V${v}` },
    {
      title: '金额',
      key: 'totalAmount',
      width: 160,
      align: 'right',
      render: (_: unknown, row) => `${row.currency} ${formatDecimalString(row.totalAmount)}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: keyof typeof QUOTATION_STATUS_LABEL) => (
        <Tag color={QUOTATION_STATUS_COLOR[value] ?? 'default'}>{QUOTATION_STATUS_LABEL[value] ?? value}</Tag>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', width: 160, render: (value: string) => formatDateTime(value) },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, row) => (
        <Link to={`/sales/quotes/${row.id}`}>
          <Button type="link" size="small">
            查看
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <Table<QuotationListItem>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报价" /> }}
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
