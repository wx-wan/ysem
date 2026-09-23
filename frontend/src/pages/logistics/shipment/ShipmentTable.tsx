import { Button, Empty, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import type { ShipmentListItem } from '../../../types/shipment';
import { formatDate, textOrDash } from '../../../utils/format';
import { SHIPMENT_STATUS_COLOR, SHIPMENT_STATUS_LABEL } from './constants';

export interface ShipmentTableProps {
  rows: ShipmentListItem[];
  loading: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/**
 * 出运单列表表格（Round F-S5）
 * 列：出运单号 · 状态 · 销售订单（链接）· 客户（链接）· 出运日期 · 承运人 · 操作
 */
export default function ShipmentTable({ rows, loading, pagination }: ShipmentTableProps) {
  const columns: ColumnsType<ShipmentListItem> = [
    { title: '出运单号', dataIndex: 'shipmentNo', width: 170, render: (v: string) => textOrDash(v) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: keyof typeof SHIPMENT_STATUS_LABEL) => (
        <Tag color={SHIPMENT_STATUS_COLOR[value] ?? 'default'}>{SHIPMENT_STATUS_LABEL[value] ?? value}</Tag>
      ),
    },
    {
      title: '销售订单',
      key: 'salesOrder',
      width: 180,
      render: (_: unknown, row) => (
        <Link to={`/sales/orders/${row.salesOrder.id}`}>{textOrDash(row.salesOrder.orderNo)}</Link>
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
    { title: '出运日期', dataIndex: 'shipmentDate', width: 120, render: (v: string | null) => formatDate(v) },
    { title: '承运人', dataIndex: 'carrier', width: 150, render: (v: string | null) => textOrDash(v) },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_: unknown, row) => (
        <Link to={`/logistics/shipment/${row.id}`}>
          <Button type="link" size="small">
            查看
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <Table<ShipmentListItem>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无出运单" /> }}
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
