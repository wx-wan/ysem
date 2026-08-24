import { Table, Tag, Button, Space, Popconfirm } from 'antd';
import {
  EyeOutlined, EditOutlined, DeleteOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { buildTablePagination } from '../../common/tablePagination';
import { SUPPLY_MODES } from '../../../config/product';
import type { Product } from '../../../api/products';
import { useDs } from '../../customer/shared/ds';

interface ProductListProps {
  data: Product[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number, pageSize: number) => void;
  onView: (r: Product) => void;
  onEdit: (r: Product) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}

export default function ProductList({
  data, total, page, pageSize, onPageChange, onView, onEdit, onDelete, canDelete,
}: ProductListProps) {
  const ds = useDs();
  const { t } = useTranslation();

  const columns: ColumnsType<Product> = [
    { title: 'SKU', dataIndex: 'sku', width: 140, render: (v: string) => v || '-' },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    { title: '分类', render: (_: unknown, r: Product) => r.category?.name || '-' },
    {
      title: '工艺',
      render: (_: unknown, r: Product) =>
        r.crafts?.length ? r.crafts.map((c) => c.name).join('+') : '-',
    },
    {
      title: '供应模式',
      render: (_: unknown, r: Product) =>
        r.supplyModes
          ? r.supplyModes.split(',').map((m: string) => {
              const f = SUPPLY_MODES.find((s) => s.value === m);
              return f ? <Tag key={m} variant="filled">{f.label}</Tag> : null;
            })
          : <span style={{ color: ds.textMuted }}>未设</span>,
    },
    {
      title: t('product.visibility'),
      dataIndex: 'visibility',
      width: 90,
      render: (v: string) =>
        v === 'PRIVATE' ? (
          <span className="pm-status pm-status--inactive">{t('product.visibilityPrivate')}</span>
        ) : (
          <span className="pm-status pm-status--active">{t('product.visibilityPublic')}</span>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right',
      render: (_: unknown, r: Product) => (
        <Space>
          <Button type="text" icon={<EyeOutlined />} onClick={() => onView(r)} />
          <Button type="text" icon={<EditOutlined />} onClick={() => onEdit(r)} />
          {canDelete ? (
            <Popconfirm title="确定删除？" onConfirm={() => onDelete(r.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <Table<Product>
      rowKey="id"
      dataSource={data}
      columns={columns}
      scroll={{ x: 900 }}
      pagination={buildTablePagination({ total, page, pageSize, onChange: onPageChange })}
    />
  );
}
