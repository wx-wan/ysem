import { Button, Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ProductListItem } from '../../types/product';
import { formatDecimalString, textOrDash } from '../../utils/format';
import { VISIBILITY_COLOR, VISIBILITY_LABEL } from './constants';

const { Text } = Typography;

export interface ProductTableProps {
  rows: ProductListItem[];
  loading: boolean;
  onEdit: (product: ProductListItem) => void;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}

/**
 * 产品列表表格（Round F-S1 §4.1）
 *
 * 列全部来自 ProductListItem 真实字段：
 *   产品编号 · 产品名称 · SKU · 分类（受众 / 品类）· 标准价 · 库存 · 可见性 · 操作
 *
 * 说明：
 *   · Product **没有** `status` 字段（只有 visibility）⇒ 本表不展示「状态」列，
 *     以「可见性」列呈现其在库的真实状态位，不虚构字段、不用其他字段冒充。
 *   · 标准价为 Decimal → string，使用 formatDecimalString 展示（**不做 Number() 转换**）。
 *   · 本阶段只提供「编辑」入口；删除不在 F-S1 范围。
 */
export default function ProductTable({ rows, loading, onEdit, pagination }: ProductTableProps) {
  const columns: ColumnsType<ProductListItem> = [
    { title: '产品编号', dataIndex: 'productNo', width: 160, render: (v: string) => textOrDash(v) },
    {
      title: '产品名称',
      dataIndex: 'name',
      ellipsis: true,
      render: (v: string) => <Text strong>{textOrDash(v)}</Text>,
    },
    { title: 'SKU', dataIndex: 'sku', width: 160, render: (v: string | null) => textOrDash(v) },
    {
      title: '分类',
      key: 'category',
      width: 190,
      render: (_: unknown, row) => {
        const parts = [row.audience?.name, row.category?.name].filter(
          (part): part is string => typeof part === 'string' && part.length > 0,
        );
        return parts.length ? parts.join(' / ') : '-';
      },
    },
    {
      title: '标准价',
      key: 'defaultPrice',
      width: 150,
      align: 'right',
      render: (_: unknown, row) =>
        row.defaultPrice === null ? '-' : `${formatDecimalString(row.defaultPrice)} ${row.defaultCurrency}`,
    },
    {
      title: '库存',
      dataIndex: 'stock',
      width: 90,
      align: 'right',
      render: (v: number | null) => (v === null ? '-' : v),
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 100,
      render: (v: ProductListItem['visibility']) => (
        <Tag color={VISIBILITY_COLOR[v] ?? 'default'}>{VISIBILITY_LABEL[v] ?? v}</Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, row) => (
        <Button type="link" size="small" onClick={() => onEdit(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Table<ProductListItem>
      rowKey="id"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无产品" /> }}
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
