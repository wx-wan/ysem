import { Button, Empty, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { SalesOrderListItem } from '../../../types/salesOrder';
import { formatDate, formatDecimalString, textOrDash } from '../../../utils/format';
import { ORDER_STATUS_COLOR, ORDER_STATUS_LABEL } from './constants';

export interface SalesOrderTableProps {
  rows: SalesOrderListItem[];
  loading: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/**
 * 销售订单列表表格（Round F-S4）
 *
 * 列全部来自 SalesOrderListItem 真实字段（SALES_ORDER_INCLUDE 投影）：
 *   订单号 · 状态 · 客户 · 商机 · 来源报价 · 金额 · 订单日期 · 操作
 * 金额取后端 `totalAmount`（Decimal → string）+ currency，**不做前端计算**；
 * 不展示负责人（D-FS4-018：后端无 owner 投影）。
 */
export default function SalesOrderTable({ rows, loading, pagination }: SalesOrderTableProps) {
  const columns: ColumnsType<SalesOrderListItem> = [
    { title: '订单号', dataIndex: 'orderNo', width: 165, render: (v: string) => textOrDash(v) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: keyof typeof ORDER_STATUS_LABEL) => (
        <Tag color={ORDER_STATUS_COLOR[value] ?? 'default'}>{ORDER_STATUS_LABEL[value] ?? value}</Tag>
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
    {
      title: '来源报价',
      key: 'quotation',
      width: 170,
      render: (_: unknown, row) =>
        row.quotation ? (
          <Link to={`/sales/quotes/${row.quotation.id}`}>{textOrDash(row.quotation.quotationNo)}</Link>
        ) : (
          '-'
        ),
    },
    {
      title: '金额',
      key: 'totalAmount',
      width: 160,
      align: 'right',
      render: (_: unknown, row) => `${row.currency} ${formatDecimalString(row.totalAmount)}`,
    },
    { title: '订单日期', dataIndex: 'orderDate', width: 120, render: (v: string | null) => formatDate(v) },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, row) => (
        <Link to={`/sales/orders/${row.id}`}>
          <Button type="link" size="small">
            查看
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <Table<SalesOrderListItem>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无销售订单" /> }}
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
