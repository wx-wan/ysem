import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Pagination, Segmented,
  Empty, Tooltip, Statistic, Row, Col,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, AppstoreOutlined, UnorderedListOutlined,
  ArrowRightOutlined, EditOutlined, DeleteOutlined, DollarOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { theme } from 'antd';
import { orderApi, Order } from '../api/customers';
import { ORDER_STAGES, getOrderStatusMeta, nextOrderStatus, OrderStatus } from '../api/orders';
import OrderFormModal from '../components/order/OrderFormModal';
import { buildTablePagination } from '../components/common/tablePagination';

const SalesOrdersPage: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { t } = useTranslation();

  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [list, setList] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, pageSize };
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const res = await orderApi.list(params);
      const d = res.data?.data;
      if (d) {
        setList(d.list || []);
        setTotal(d.total || 0);
      }
    } catch (e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter, search, message]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 统计卡（本地计算）
  const stats = useMemo(() => {
    const totalAmount = list.reduce((s, o) => s + (o.amountCNY || 0), 0);
    const inProgress = list.filter((o) => o.status !== 'SHIPPED').length;
    return { count: total || list.length, totalAmount, inProgress };
  }, [list, total]);

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (o: Order) => { setEditing(o); setModalOpen(true); };

  const handleDelete = async (id: string) => {
    try {
      await orderApi.remove(id);
      message.success('删除成功');
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const advanceStage = async (o: Order) => {
    const next = nextOrderStatus(o.status);
    if (!next) return;
    try {
      await orderApi.update(o.id, { status: next });
      message.success(`已推进至「${getOrderStatusMeta(next).label}」`);
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  // ===== 看板视图 =====
  const KanbanView = () => (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {ORDER_STAGES.map((stage) => {
        const colItems = statusFilter || search
          ? list.filter((o) => o.status === stage.key)
          : list.filter((o) => o.status === stage.key);
        return (
          <div
            key={stage.key}
            style={{
              flex: '0 0 260px',
              background: token.colorFillQuaternary,
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 280px)',
            }}
          >
            <div
              style={{
                padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                borderTop: `3px solid ${stage.accent}`, borderTopLeftRadius: token.borderRadiusLG, borderTopRightRadius: token.borderRadiusLG,
              }}
            >
              <span style={{ fontWeight: 600 }}>{stage.label}</span>
              <Tag color={stage.color} style={{ marginInlineEnd: 0 }}>{colItems.length}</Tag>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
              {colItems.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无" style={{ margin: '16px 0' }} />}
              {colItems.map((o) => (
                <div
                  key={o.id}
                  style={{
                    background: token.colorBgContainer, borderRadius: token.borderRadiusLG,
                    border: `1px solid ${token.colorBorderSecondary}`, padding: 12,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{o.orderNo || '未命名订单'}</div>
                  <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>
                    {o.customer?.companyName || '-'}
                  </div>
                  <Space size={4} style={{ width: '100%', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: token.colorPrimary }}>
                      ¥{(o.amountCNY || 0).toLocaleString()}
                    </span>
                    <Space size={2}>
                      <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(o)} />
                      </Tooltip>
                      <Tooltip title="推进到下一阶段">
                        <Button
                          type="text" size="small" icon={<ArrowRightOutlined />}
                          disabled={!nextOrderStatus(o.status)}
                          onClick={() => advanceStage(o)}
                        />
                      </Tooltip>
                    </Space>
                  </Space>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ===== 列表视图 =====
  const columns = [
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', render: (v: string) => v || '-' },
    {
      title: '客户', key: 'customer', render: (_: any, o: Order) => o.customer?.companyName || '-',
    },
    {
      title: '阶段', key: 'status', width: 110,
      render: (_: any, o: Order) => {
        const m = getOrderStatusMeta(o.status);
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: '订单金额', dataIndex: 'amountCNY', key: 'amountCNY',
      render: (v: number) => v ? `¥${v.toLocaleString()}` : '-',
    },
    {
      title: '预付款', key: 'deposit',
      render: (_: any, o: Order) => (
        <Space size={4}>
          {o.depositAmount ? <span>¥{o.depositAmount.toLocaleString()}</span> : <span style={{ color: token.colorTextQuaternary }}>-</span>}
          {o.depositPaid && <Tag color="green" style={{ marginInlineEnd: 0 }}>已付</Tag>}
        </Space>
      ),
    },
    { title: '交付日期', dataIndex: 'deliveryDate', key: 'deliveryDate', render: (v: string) => v || '-' },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, o: Order) => (
        <Space size={4}>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(o)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(o.id)} okText="删除" cancelText="取消">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ListView = () => (
    <Card variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
      <Table
        rowKey="id"
        columns={columns}
        dataSource={list}
        loading={loading}
        size="middle"
        scroll={{ x: 900 }}
        pagination={false}
      />
      {total > pageSize && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
          <Pagination
            {...buildTablePagination({
              total, page, pageSize,
              onChange: (p) => setPage(p),
            })}
          />
        </div>
      )}
    </Card>
  );

  return (
    <div style={{ padding: 24, minHeight: '100%' }}>
      {/* 统计卡 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Statistic title="订单总数" value={stats.count} suffix="单" />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Statistic title="订单总金额" value={stats.totalAmount} prefix={<DollarOutlined />} precision={0} />
          </Card>
        </Col>
        <Col span={8}>
          <Card variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Statistic title="进行中（未出货）" value={stats.inProgress} suffix="单" />
          </Card>
        </Col>
      </Row>

      {/* 工具栏 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', marginBottom: 16,
          background: token.colorBgContainer, borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderBottom: `1px dashed ${token.colorBorderSecondary}`,
        }}
      >
        <Space>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as any)}
            options={[
              { label: '看板', value: 'kanban', icon: <AppstoreOutlined /> },
              { label: '列表', value: 'list', icon: <UnorderedListOutlined /> },
            ]}
          />
          <Select
            allowClear placeholder="按阶段筛选"
            style={{ width: 160 }}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={ORDER_STAGES.map((s) => ({ value: s.key, label: s.label }))}
          />
          <Input.Search
            allowClear placeholder="搜索订单号/客户"
            style={{ width: 220 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={() => { setPage(1); fetchList(); }}
          />
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchList}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建订单</Button>
        </Space>
      </div>

      {viewMode === 'kanban' ? <KanbanView /> : <ListView />}

      <OrderFormModal
        open={modalOpen}
        editingOrder={editing}
        onClose={() => setModalOpen(false)}
        onSuccess={fetchList}
      />
    </div>
  );
};

export default SalesOrdersPage;
