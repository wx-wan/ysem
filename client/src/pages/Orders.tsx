import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space,
  Card, Statistic, Row, Col, message, Popconfirm, DatePicker,
  Typography,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined,
  ShoppingCartOutlined, DeleteOutlined, EyeOutlined,
} from '@ant-design/icons';
import { orderApi, Order } from '../api/customers';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import dayjs from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;

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

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [form] = Form.useForm();

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
    form.resetFields();
    form.setFieldsValue({ status: 'PENDING' });
    setModalOpen(true);
  };

  const openEdit = (order: Order) => {
    setEditingOrder(order);
    form.setFieldsValue({ ...order });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingOrder) {
        await orderApi.update(editingOrder.id, values);
        message.success('更新成功');
      } else {
        await orderApi.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch (e: any) {
      if (e.errorFields) return;
      const msg = e?.response?.data?.message || e?.message || '操作失败';
      message.error(msg);
    }
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
      setDetailOrder(res.data.data);
      setDetailOpen(true);
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
      title: '金额(CNY)',
      dataIndex: 'amountCNY',
      key: 'amountCNY',
      width: 130,
      align: 'right' as const,
      render: (v: number) => v != null ? `¥${v.toLocaleString()}` : '-',
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
              title="累计金额 (CNY)"
              value={totalAmount}
              precision={0}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Statistic
              title="当前页金额"
              value={list.reduce((s, o) => s + (o.amountCNY || 0), 0)}
              precision={0}
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
      <Modal
        title={editingOrder ? '编辑订单' : '新增订单'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="customerId"
            label="客户ID"
            rules={editingOrder ? [] : [{ required: true, message: '请输入客户ID' }]}
          >
            <Input placeholder="从客户详情页复制客户ID" disabled={!!editingOrder} />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="orderNo" label="订单号" style={{ width: 170 }}>
              <Input placeholder="订单号" />
            </Form.Item>
            <Form.Item name="orderDate" label="订单日期" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="amountCNY" label="金额(CNY)" style={{ width: 170 }}>
              <Input type="number" placeholder="0.00" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="deliveryDate" label="交付日期" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="paymentTerms" label="付款条件" style={{ width: 170 }}>
              <Input placeholder="如 T/T 30%" />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 170 }}>
              <Select>
                <Select.Option value="PENDING">待确认</Select.Option>
                <Select.Option value="CONFIRMED">已确认</Select.Option>
                <Select.Option value="IN_PRODUCTION">生产中</Select.Option>
                <Select.Option value="SHIPPED">已发货</Select.Option>
                <Select.Option value="DELIVERED">已交付</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title="订单详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={560}
      >
        {detailOrder && (
          <div>
            <Row gutter={[16, 12]}>
              <Col span={12}><Text type="secondary">订单号</Text><br /><Text strong>{detailOrder.orderNo || '-'}</Text></Col>
              <Col span={12}><Text type="secondary">客户</Text><br /><Text>{detailOrder.customer?.companyName || '-'}</Text></Col>
              <Col span={12}><Text type="secondary">订单日期</Text><br /><Text>{detailOrder.orderDate || '-'}</Text></Col>
              <Col span={12}><Text type="secondary">金额(CNY)</Text><br /><Text strong style={{ fontSize: 16 }}>¥{(detailOrder.amountCNY ?? 0).toLocaleString()}</Text></Col>
              <Col span={12}><Text type="secondary">交付日期</Text><br /><Text>{detailOrder.deliveryDate || '-'}</Text></Col>
              <Col span={12}><Text type="secondary">付款条件</Text><br /><Text>{detailOrder.paymentTerms || '-'}</Text></Col>
              <Col span={12}>
                <Text type="secondary">状态</Text><br />
                <Tag color={STATUS_OPTIONS[detailOrder.status || '']?.color || 'default'}>
                  {STATUS_OPTIONS[detailOrder.status || '']?.label || detailOrder.status || '-'}
                </Tag>
              </Col>
              <Col span={12}><Text type="secondary">联系人</Text><br /><Text>{detailOrder.customer?.contactName || '-'}</Text></Col>
              {detailOrder.notes && (
                <Col span={24}><Text type="secondary">备注</Text><br /><Text>{detailOrder.notes}</Text></Col>
              )}
            </Row>
          </div>
        )}
      </Modal>
    </div>
  );
}
