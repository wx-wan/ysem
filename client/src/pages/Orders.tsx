import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Input, Select, Tag, Space,
  Card, Statistic, Row, Col, message, Popconfirm,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined,
  ShoppingCartOutlined, DeleteOutlined, EyeOutlined,
} from '@ant-design/icons';
import { orderApi, Order } from '../api/customers';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import OrderFormModal from '../components/order/OrderFormModal';
import OrderDetailModal from '../components/order/OrderDetailModal';

const STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待确认', color: 'default' },
  CONFIRMED: { label: '已确认', color: 'processing' },
  IN_PRODUCTION: { label: '生产中', color: 'orange' },
  SHIPPED: { label: '已发货', color: 'cyan' },
  DELIVERED: { label: '已交付', color: 'green' },
};

export default function OrdersPage() {
  const { format: formatCurrency, formatWithDate } = useCurrencyStore();

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [totalAmount, setTotalAmount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [detailFormattedAmount, setDetailFormattedAmount] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  const pageSize = 15;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
        keyword: keyword || undefined,
        status: status || undefined,
      };
      const res = await orderApi.list(params);
      const data = res.data.data;
      setList(data.list);
      setTotal(data.total);
      setTotalAmount(data.totalAmount);
      setTotalCount(data.totalCount);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, keyword, status]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = () => {
    setEditingOrder(null);
    setModalOpen(true);
  };

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await orderApi.remove(id);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '操作失败';
      message.error(msg);
    }
  };

  const openDetail = async (order: Order) => {
    try {
      const res = await orderApi.getById(order.id);
      const ord = res.data.data;
      setDetailOrder(ord);
      setDetailOpen(true);
      // 异步获取历史汇率格式化金额
      if (ord.orderDate) {
        formatWithDate(ord.amountCNY || 0, ord.orderDate).then(setDetailFormattedAmount);
      } else {
        setDetailFormattedAmount(formatCurrency(ord.amountCNY || 0));
      }
    } catch {
      message.error('加载失败');
    }
  };

  const columns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 140,
      render: (v: string, r: Order) => (
        <a onClick={() => openDetail(r)}>{v || '-'}</a>
      ),
    },
    {
      title: '客户',
      key: 'customer',
      width: 180,
      render: (_: any, r: Order) => r.customer?.companyName || '-',
    },
    {
      title: '订单日期',
      dataIndex: 'orderDate',
      key: 'orderDate',
      width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '金额',
      dataIndex: 'amountCNY',
      key: 'amountCNY',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v != null ? formatCurrency(v) : '-',
    },
    {
      title: '交付日期',
      dataIndex: 'deliveryDate',
      key: 'deliveryDate',
      width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '付款条件',
      dataIndex: 'paymentTerms',
      key: 'paymentTerms',
      width: 110,
      render: (v: string) => v || '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (v: string) => {
        const s = STATUS_OPTIONS[v] || { label: v || '-', color: 'default' };
        return <Tag color={s.color}>{s.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      fixed: 'right' as const,
      render: (_: any, r: Order) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)} />
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 0 24px' }}>
      <h2 style={{ marginBottom: 16 }}>订单管理</h2>

      {/* 统计 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="订单总数"
              value={totalCount}
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="累计金额"
              value={totalAmount}
              precision={0}
              valueStyle={{ color: '#52c41a' }}
              formatter={(v) => formatCurrency(Number(v))}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="当前页金额"
              value={list.reduce((s, o) => s + (o.amountCNY || 0), 0)}
              precision={0}
              formatter={(v) => formatCurrency(Number(v))}
            />
          </Card>
        </Col>
      </Row>

      {/* 工具栏 */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input.Search
          placeholder="搜索订单号/客户"
          style={{ width: 240 }}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={() => { setPage(1); fetchData(); }}
          allowClear
        />
        <Select
          placeholder="状态筛选"
          allowClear
          style={{ width: 130 }}
          value={status || undefined}
          onChange={(v) => { setStatus(v || ''); setPage(1); }}
        >
          <Select.Option value="PENDING">待确认</Select.Option>
          <Select.Option value="CONFIRMED">已确认</Select.Option>
          <Select.Option value="IN_PRODUCTION">生产中</Select.Option>
          <Select.Option value="SHIPPED">已发货</Select.Option>
          <Select.Option value="DELIVERED">已交付</Select.Option>
        </Select>
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增订单
        </Button>
      </div>

      {/* 表格 */}
      <Table
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
        size="middle"
      />

      {/* 创建/编辑弹窗 */}
      <OrderFormModal
        open={modalOpen}
        editingOrder={editingOrder}
        onClose={() => { setModalOpen(false); setEditingOrder(null); }}
        onSuccess={fetchData}
      />

      {/* 详情弹窗 */}
      <OrderDetailModal
        open={detailOpen}
        detailOrder={detailOrder}
        formattedAmount={detailFormattedAmount}
        formatCurrency={formatCurrency}
        onClose={() => { setDetailOpen(false); setDetailOrder(null); }}
      />
    </div>
  );
}
