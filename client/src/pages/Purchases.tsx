import React, { useCallback, useEffect, useState } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Statistic, Row, Col,
  DatePicker, Modal, Descriptions, Empty, Tooltip,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, SearchOutlined, EyeOutlined, EditOutlined,
  DeleteOutlined, ArrowRightOutlined, CloseCircleOutlined, CheckOutlined, InboxOutlined,
} from '@ant-design/icons';
import { theme } from 'antd';
import { purchaseApi, PurchaseOrder, PurchaseStatus, PURCHASE_STATUS_TEXT, PURCHASE_STATUS_COLOR, PurchaseItem } from '../api/purchases';
import PurchaseFormModal from '../components/purchase/PurchaseFormModal';

const { RangePicker } = DatePicker;

// 每个状态可执行的动作
const STATUS_ACTIONS: Record<PurchaseStatus, { to: PurchaseStatus; label: string }[]> = {
  DRAFT: [
    { to: 'ORDERED', label: '下单' },
    { to: 'CANCELLED', label: '取消' },
  ],
  ORDERED: [
    { to: 'PARTIAL', label: '部分到货' },
    { to: 'ARRIVED', label: '已到货' },
    { to: 'CANCELLED', label: '取消' },
  ],
  PARTIAL: [
    { to: 'ARRIVED', label: '已到货' },
    { to: 'CANCELLED', label: '取消' },
  ],
  ARRIVED: [],
  CANCELLED: [],
};

const PurchasesPage: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  const [list, setList] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ total: 0, pending: 0, amountCNY: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [dateRange, setDateRange] = useState<[string, string] | undefined>(undefined);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [detail, setDetail] = useState<PurchaseOrder | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = { page, pageSize };
      if (keyword) params.keyword = keyword;
      if (statusFilter) params.status = statusFilter;
      if (dateRange) {
        params.startDate = dateRange[0];
        params.endDate = dateRange[1];
      }
      const res = await purchaseApi.list(params);
      const d = res.data?.data;
      if (d) {
        setList(d.items || []);
        setTotal(d.total || 0);
        setStats(d.stats || { total: 0, pending: 0, amountCNY: 0 });
      }
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, statusFilter, dateRange, message]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (o: PurchaseOrder) => {
    setEditing(o);
    setModalOpen(true);
  };
  const openDetail = async (o: PurchaseOrder) => {
    try {
      const res = await purchaseApi.detail(o.id);
      setDetail(res.data?.data?.item || o);
    } catch {
      setDetail(o);
    }
  };

  const changeStatus = async (o: PurchaseOrder, to: PurchaseStatus) => {
    try {
      await purchaseApi.changeStatus(o.id, to);
      message.success(`已更新为「${PURCHASE_STATUS_TEXT[to]}」`);
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '操作失败');
    }
  };

  const handleDelete = async (o: PurchaseOrder) => {
    try {
      await purchaseApi.remove(o.id);
      message.success('删除成功');
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const parseItems = (o: PurchaseOrder): PurchaseItem[] => {
    try {
      return o.items ? (JSON.parse(o.items) as PurchaseItem[]) : [];
    } catch {
      return [];
    }
  };

  const columns = [
    {
      title: '采购单号',
      dataIndex: 'purchaseNo',
      key: 'purchaseNo',
      render: (v: string, o: PurchaseOrder) => (
        <a onClick={() => openDetail(o)} style={{ fontWeight: 500 }}>{v || '-'}</a>
      ),
    },
    {
      title: '供应商',
      key: 'supplier',
      width: 180,
      render: (_: unknown, o: PurchaseOrder) => o.supplier?.name || '-',
    },
    { title: '采购日期', dataIndex: 'purchaseDate', key: 'purchaseDate', width: 110, render: (v?: string) => v || '-' },
    {
      title: '明细',
      key: 'items',
      width: 70,
      render: (_: unknown, o: PurchaseOrder) => parseItems(o).length || 0,
    },
    {
      title: '金额（CNY）',
      dataIndex: 'amountCNY',
      key: 'amountCNY',
      width: 130,
      render: (v?: number) => (v ? <span style={{ fontWeight: 600, color: token.colorPrimary }}>¥{v.toLocaleString()}</span> : '-'),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: PurchaseStatus) => <Tag color={PURCHASE_STATUS_COLOR[v]}>{PURCHASE_STATUS_TEXT[v]}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 220,
      render: (_: unknown, o: PurchaseOrder) => {
        const actions = STATUS_ACTIONS[o.status] || [];
        return (
          <Space size={2}>
            <Tooltip title="详情">
              <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(o)} />
            </Tooltip>
            {['DRAFT', 'ORDERED'].includes(o.status) && (
              <Tooltip title="编辑">
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(o)} />
              </Tooltip>
            )}
            {actions.map((a) =>
              a.to === 'CANCELLED' ? (
                <Popconfirm
                  key={a.to}
                  title="确定取消该采购单？"
                  onConfirm={() => changeStatus(o, a.to)}
                >
                  <Tooltip title="取消">
                    <Button type="text" size="small" danger icon={<CloseCircleOutlined />} />
                  </Tooltip>
                </Popconfirm>
              ) : (
                <Tooltip key={a.to} title={a.label}>
                  <Button
                    type="text"
                    size="small"
                    icon={a.to === 'ARRIVED' ? <CheckOutlined /> : <ArrowRightOutlined />}
                    onClick={() => changeStatus(o, a.to)}
                  />
                </Tooltip>
              ),
            )}
            {['DRAFT', 'CANCELLED'].includes(o.status) && (
              <Popconfirm title="确定删除该采购单？" onConfirm={() => handleDelete(o)}>
                <Tooltip title="删除">
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Tooltip>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const detailItems = detail ? parseItems(detail) : [];

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 统计卡 */}
      <Row gutter={16}>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic title="采购单总数" value={stats.total} prefix={<InboxOutlined style={{ color: token.colorPrimary }} />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic title="待入库（已下单/部分到货）" value={stats.pending} valueStyle={{ color: '#fa8c16' }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" style={{ borderRadius: 12 }}>
            <Statistic
              title="采购总额（CNY）"
              value={stats.amountCNY}
              precision={2}
              valueStyle={{ color: token.colorPrimary }}
            />
          </Card>
        </Col>
      </Row>

      {/* 工具栏 */}
      <Card size="small" style={{ borderRadius: 12 }}>
        <Space wrap>
          <Input
            placeholder="搜索单号 / 供应商"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            allowClear
            style={{ width: 220 }}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
          />
          <Select
            placeholder="状态"
            allowClear
            style={{ width: 140 }}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
          >
            {Object.entries(PURCHASE_STATUS_TEXT).map(([k, v]) => (
              <Select.Option key={k} value={k}>{v}</Select.Option>
            ))}
          </Select>
          <RangePicker
            onChange={(_, dateStrings) => {
              setDateRange(dateStrings[0] && dateStrings[1] ? [dateStrings[0], dateStrings[1]] : undefined);
              setPage(1);
            }}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchList}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建采购单</Button>
        </Space>
      </Card>

      {/* 表格 */}
      <Card size="small" style={{ borderRadius: 12 }}>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={list}
          loading={loading}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无采购单" /> }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
          }}
        />
      </Card>

      {/* 新建/编辑 */}
      <PurchaseFormModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSuccess={fetchList}
      />

      {/* 详情 */}
      <Modal
        title={`采购单详情${detail?.purchaseNo ? ' · ' + detail.purchaseNo : ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={<Button onClick={() => setDetail(null)}>关闭</Button>}
        width={760}
      >
        {detail && (
          <>
            <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="供应商">{detail.supplier?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="采购日期">{detail.purchaseDate || '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={PURCHASE_STATUS_COLOR[detail.status]}>{PURCHASE_STATUS_TEXT[detail.status]}</Tag>
              </Descriptions.Item>
            </Descriptions>
            <Table
              size="small"
              rowKey={(r, i) => `${r.productId || 'x'}-${i}`}
              dataSource={detailItems}
              pagination={false}
              locale={{ emptyText: '暂无明细' }}
              columns={[
                { title: '产品名称', dataIndex: 'name', render: (v: string) => v || '-' },
                { title: '规格', dataIndex: 'spec', render: (v?: string) => v || '-' },
                { title: '数量', dataIndex: 'quantity', width: 90 },
                { title: '单价(CNY)', dataIndex: 'unitPrice', width: 110, render: (v?: number) => (v ? v.toLocaleString() : '-') },
                { title: '金额(CNY)', dataIndex: 'amount', width: 120, render: (v?: number) => (v ? v.toLocaleString() : '-') },
              ]}
            />
            <Row justify="end" style={{ marginTop: 12 }}>
              <Space>
                <span style={{ color: '#8c8c8c' }}>合计金额</span>
                <span style={{ fontSize: 16, fontWeight: 600, color: token.colorPrimary }}>
                  ¥{(detail.amountCNY || 0).toLocaleString()}
                </span>
              </Space>
            </Row>
            {detail.remark && (
              <div style={{ marginTop: 12, fontSize: 13, color: token.colorTextSecondary }}>
                备注：{detail.remark}
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};

export default PurchasesPage;
