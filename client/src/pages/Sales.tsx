import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Modal, Form, Drawer,
  Tag, Popconfirm, message, Upload, Tabs, Descriptions, Statistic, Row, Col, Empty, Tooltip, Badge,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  AppstoreOutlined, UnorderedListOutlined, ImportOutlined,
  InboxOutlined, RightOutlined, LeftOutlined, TeamOutlined, DollarOutlined, EditOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { salesApi, SalesItem } from '../api/sales';
import { useCurrencyStore } from '../stores/useCurrencyStore';

const STAGES = [
  { key: 'LEAD', label: '线索', color: '#3b82f6', bg: '#eff6ff' },
  { key: 'OPPORTUNITY', label: '商机', color: '#f59e0b', bg: '#fffbeb' },
  { key: 'SAMPLE', label: '样品单', color: '#8b5cf6', bg: '#f5f3ff' },
  { key: 'ORDER', label: '订单', color: '#10b981', bg: '#ecfdf5' },
];

const SOURCE_OPTIONS = [
  { label: '手动录入', value: 'MANUAL' },
  { label: 'Excel导入', value: 'EXCEL' },
  { label: '小满API', value: 'XIAOMAN' },
];

const STAGE_LABELS: Record<string, string> = {
  LEAD: '线索', OPPORTUNITY: '商机', SAMPLE: '样品单', ORDER: '订单',
};

export default function Sales() {
  const { t } = useTranslation();
  const { format: formatCurrency } = useCurrencyStore();

  // 视图模式
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');

  // 数据状态
  const [kanbanData, setKanbanData] = useState<Record<string, { title: string; items: SalesItem[] }>>({});
  const [listData, setListData] = useState<SalesItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterStage, setFilterStage] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<SalesItem | null>(null);
  const [assignUsers, setAssignUsers] = useState<{ id: string; realName: string }[]>([]);

  const [form] = Form.useForm();

  const stageForForm = Form.useWatch('stage', form) || 'LEAD';

  // ============ 数据加载 ============

  const fetchKanban = useCallback(async () => {
    setLoading(true);
    try {
      const res = await salesApi.kanban();
      setKanbanData(res.data.data.columns);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
      if (keyword) params.keyword = keyword;
      if (filterStage) params.stage = filterStage;
      const res = await salesApi.list(params);
      setListData(res.data.data.list);
      setTotal(res.data.data.total);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, filterStage]);

  const fetchAssignUsers = async () => {
    try {
      const res = await salesApi.getAssignUsers();
      setAssignUsers(res.data.data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (viewMode === 'kanban') fetchKanban();
    else fetchList();
  }, [viewMode, fetchKanban, fetchList]);

  const refresh = () => {
    if (viewMode === 'kanban') fetchKanban();
    else fetchList();
  };

  // ============ 操作 ============

  const handleCreate = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ stage: 'LEAD' });
    fetchAssignUsers();
    setModalOpen(true);
  };

  const handleEdit = (item: SalesItem) => {
    setEditingItem(item);
    form.setFieldsValue(item);
    fetchAssignUsers();
    setModalOpen(true);
  };

  const handleViewDetail = async (id: string) => {
    try {
      const res = await salesApi.get(id);
      setDetailItem(res.data.data);
      setDetailOpen(true);
    } catch { /* ignore */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await salesApi.delete(id);
      message.success('删除成功');
      refresh();
    } catch { /* ignore */ }
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.length === 0) { message.warning('请先选择记录'); return; }
    try {
      await salesApi.batchDelete(selectedKeys);
      message.success('删除成功');
      setSelectedKeys([]);
      refresh();
    } catch { /* ignore */ }
  };

  const handleFormSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingItem) {
        await salesApi.update(editingItem.id, values);
        message.success('更新成功');
      } else {
        await salesApi.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      refresh();
    } catch { /* ignore */ }
  };

  const handleStageChange = async (id: string, newStage: string) => {
    try {
      await salesApi.changeStage(id, newStage);
      message.success('阶段已变更');
      refresh();
      if (detailOpen && detailItem) {
        const res = await salesApi.get(detailItem.id);
        setDetailItem(res.data.data);
      }
    } catch { /* ignore */ }
  };

  const handleImport = async (file: File) => {
    try {
      const res = await salesApi.importExcel(file);
      message.success(`导入完成：成功 ${res.data.data.successCount} 条，失败 ${res.data.data.failCount} 条`);
      setImportOpen(false);
      refresh();
    } catch { /* ignore */ }
    return false; // 阻止 Upload 默认上传
  };

  // ============ 阶段前进/后退按钮 ============

  const StageButtons = ({ item }: { item: SalesItem }) => {
    const idx = STAGES.findIndex((s) => s.key === item.stage);
    return (
      <Space size={4}>
        {idx > 0 && (
          <Tooltip title={`退回到${STAGES[idx - 1].label}`}>
            <Button
              size="small"
              type="text"
              icon={<LeftOutlined />}
              onClick={() => handleStageChange(item.id, STAGES[idx - 1].key)}
            />
          </Tooltip>
        )}
        {idx < STAGES.length - 1 && (
          <Tooltip title={`推进到${STAGES[idx + 1].label}`}>
            <Button
              size="small"
              type="text"
              icon={<RightOutlined />}
              onClick={() => handleStageChange(item.id, STAGES[idx + 1].key)}
            />
          </Tooltip>
        )}
      </Space>
    );
  };

  // ============ 表格列定义 ============

  const columns: ColumnsType<SalesItem> = useMemo(() => [
    { title: '标题', dataIndex: 'title', width: 180, ellipsis: true },
    { title: '公司', dataIndex: 'companyName', width: 140 },
    { title: '联系人', dataIndex: 'contactName', width: 100 },
    {
      title: '阶段', dataIndex: 'stage', width: 90,
      render: (s: string) => {
        const st = STAGES.find((x) => x.key === s);
        return <Tag color={st?.color}>{st?.label || s}</Tag>;
      },
    },
    {
      title: '金额', dataIndex: 'estimatedAmount', width: 120,
      render: (_: unknown, r: SalesItem) => {
        const amt = r.stage === 'ORDER' ? r.orderAmount : r.estimatedAmount;
        return amt ? formatCurrency(amt) : '-';
      },
    },
    { title: '来源', dataIndex: 'source', width: 90 },
    {
      title: '负责人', dataIndex: 'assignee', width: 80,
      render: (v: SalesItem['assignee']) => v?.realName || '-',
    },
    {
      title: '更新时间', dataIndex: 'updatedAt', width: 120,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
    {
      title: '操作', key: 'action', width: 160, fixed: 'right',
      render: (_: unknown, r: SalesItem) => (
        <Space size="small">
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => handleViewDetail(r.id)}>详情</Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>编辑</Button>
          <StageButtons item={r} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [formatCurrency, refresh]);

  // ============ 看板卡片 ============

  const KanbanCard = ({ item }: { item: SalesItem }) => (
    <Card
      hoverable
      size="small"
      style={{ marginBottom: 10, borderRadius: 8 }}
      onClick={() => handleViewDetail(item.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 4 }}>
            <TeamOutlined style={{ marginRight: 4 }} />
            {item.companyName}
          </div>
          {item.contactName && (
            <div style={{ color: '#94a3b8', fontSize: 12 }}>{item.contactName}</div>
          )}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          {(item.estimatedAmount || item.orderAmount) && (
            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 13, whiteSpace: 'nowrap' }}>
              <DollarOutlined style={{ fontSize: 11 }} />{' '}
              {formatCurrency(item.stage === 'ORDER' ? (item.orderAmount || 0) : (item.estimatedAmount || 0))}
            </div>
          )}
          {item.probability && item.stage === 'OPPORTUNITY' && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 2 }}>{item.probability}%</div>
          )}
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {item.assignee?.realName || '未分配'}
        </span>
        <StageButtons item={item} />
      </div>
    </Card>
  );

  // ============ 看板视图 ============

  const KanbanView = () => (
    <div style={{ display: 'flex', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
      {STAGES.map((stage) => {
        const col = kanbanData[stage.key] || { title: stage.label, items: [] };
        return (
          <div
            key={stage.key}
            style={{
              flex: '1 1 0', minWidth: 280, maxWidth: 380,
              backgroundColor: stage.bg,
              borderRadius: 12, padding: 12,
            }}
          >
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              marginBottom: 12, padding: '0 4px',
            }}>
              <Space>
                <Badge color={stage.color} />
                <span style={{ fontWeight: 600, color: stage.color }}>{col.title}</span>
                <span style={{ color: '#94a3b8', fontSize: 13 }}>({col.items.length})</span>
              </Space>
              <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ stage: stage.key }); setEditingItem(null); fetchAssignUsers(); setModalOpen(true); }}>
                新增
              </Button>
            </div>
            <div style={{ maxHeight: 'calc(100vh - 260px)', overflowY: 'auto', padding: '0 2px' }}>
              {col.items.length === 0 ? (
                <Empty description={`暂无${col.title}`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                col.items.map((item) => <KanbanCard key={item.id} item={item} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ============ 列表视图 ============

  const ListView = () => (
    <Card variant="borderless" style={{ borderRadius: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space wrap>
          <Select
            style={{ width: 130 }}
            placeholder="阶段筛选"
            allowClear
            value={filterStage || undefined}
            onChange={(v) => { setFilterStage(v || ''); setPage(1); }}
            options={STAGES.map((s) => ({ label: s.label, value: s.key }))}
          />
          <Input
            style={{ width: 200 }}
            placeholder="搜索标题/公司/联系人"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => { setPage(1); fetchList(); }}
          />
          <Button onClick={() => { setPage(1); fetchList(); }}>搜索</Button>
          <Button icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>
        </Space>
        <Space>
          {selectedKeys.length > 0 && (
            <Popconfirm title={`确定删除 ${selectedKeys.length} 条记录？`} onConfirm={handleBatchDelete}>
              <Button danger icon={<DeleteOutlined />}>批量删除</Button>
            </Popconfirm>
          )}
        </Space>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={listData}
        loading={loading}
        size="small"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
        scroll={{ x: 1000 }}
        pagination={{
          current: page, pageSize, total,
          showSizeChanger: true, showTotal: (t) => `共 ${t} 条`,
          onChange: (p, s) => { setPage(p); setPageSize(s); },
        }}
      />
    </Card>
  );

  // ============ 创建/编辑弹窗 ============

  const FormModal = () => (
    <Modal
      title={editingItem ? '编辑' : '新增'}
      open={modalOpen}
      onCancel={() => setModalOpen(false)}
      onOk={handleFormSubmit}
      width={720}
      destroyOnClose
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="title" label="标题" rules={[{ required: true }]}>
              <Input placeholder="如：ABC公司询价" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="stage" label="阶段">
              <Select options={STAGES.map((s) => ({ label: s.label, value: s.key }))} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="contactName" label="联系人">
              <Input />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item name="country" label="国家">
              <Input />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="email" label="邮箱">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="phone" label="电话">
              <Input />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="source" label="来源">
              <Select options={SOURCE_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        {/* --- 线索字段 --- */}
        {stageForForm === 'LEAD' && (
          <>
            <Form.Item name="productInterest" label="感兴趣产品">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item name="leadNotes" label="备注">
              <Input.TextArea rows={2} />
            </Form.Item>
          </>
        )}

        {/* --- 商机字段 --- */}
        {stageForForm === 'OPPORTUNITY' && (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="estimatedAmount" label="预估金额(¥)">
                <Input type="number" prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="probability" label="成交概率(%)">
                <Input type="number" min={0} max={100} suffix="%" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="estimatedCloseDate" label="预计成交日期">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* --- 样品字段 --- */}
        {stageForForm === 'SAMPLE' && (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sampleType" label="样品类型">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleQuantity" label="样品数量">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleStatus" label="样品状态">
                <Select options={[
                  { label: '待发送', value: 'PENDING' },
                  { label: '已发送', value: 'SENT' },
                  { label: '已确认', value: 'CONFIRMED' },
                  { label: '已反馈', value: 'FEEDBACK' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
        )}

        {/* --- 订单字段 --- */}
        {stageForForm === 'ORDER' && (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="orderAmount" label="订单金额(¥)">
                <Input type="number" prefix="¥" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="orderDate" label="下单日期">
                <Input type="date" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="deliveryDate" label="交付日期">
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        )}
        {stageForForm === 'ORDER' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="paymentTerms" label="付款条件">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="orderStatus" label="订单状态">
                <Select options={[
                  { label: '待确认', value: 'PENDING' },
                  { label: '已确认', value: 'CONFIRMED' },
                  { label: '生产中', value: 'IN_PRODUCTION' },
                  { label: '已发货', value: 'SHIPPED' },
                  { label: '已交付', value: 'DELIVERED' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
        )}

        <Form.Item name="assignedTo" label="负责人">
          <Select
            allowClear
            placeholder="选择负责人"
            options={assignUsers.map((u) => ({ label: u.realName, value: u.id }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );

  // ============ 导入弹窗 ============

  const ImportModal = () => {
    const [importTab, setImportTab] = useState('excel');

    return (
      <Modal
        title="导入数据"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={600}
      >
        <Tabs activeKey={importTab} onChange={setImportTab} items={[
          {
            key: 'excel',
            label: 'Excel 导入',
            children: (
              <div>
                <Upload.Dragger
                  accept=".xlsx,.xls,.csv"
                  maxCount={1}
                  beforeUpload={handleImport}
                  showUploadList={false}
                >
                  <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                  <p>点击或拖拽上传 Excel 文件</p>
                  <p style={{ color: '#94a3b8', fontSize: 12 }}>
                    支持 .xlsx / .xls / .csv 格式
                  </p>
                </Upload.Dragger>
                <div style={{ marginTop: 16, padding: '12px 16px', background: '#f8fafc', borderRadius: 8, fontSize: 12, color: '#64748b' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>表头字段参考：</div>
                  <div>标题、公司名称、联系人、邮箱、电话、国家、阶段、来源、产品兴趣</div>
                  <div>预估金额、预计成交日期、成交概率、样品类型、样品数量、样品状态</div>
                  <div>订单金额、订单日期、交付日期、付款条件、订单状态</div>
                  <div style={{ marginTop: 6, color: '#f59e0b' }}>阶段可选值：线索 / 商机 / 样品单 / 订单</div>
                </div>
              </div>
            ),
          },
          {
            key: 'xiaoman',
            label: '小满 API',
            children: (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <InboxOutlined style={{ fontSize: 48, color: '#94a3b8', marginBottom: 16 }} />
                <p style={{ color: '#64748b' }}>小满 API 对接功能开发中</p>
                <p style={{ color: '#94a3b8', fontSize: 12 }}>
                  后续将支持通过小满开放接口自动同步客户与商机数据
                </p>
              </div>
            ),
          },
        ]} />
      </Modal>
    );
  };

  // ============ 详情抽屉 ============

  const DetailDrawer = () => {
    if (!detailItem) return null;
    const st = STAGES.find((s) => s.key === detailItem.stage);
    return (
      <Drawer
        title="详情"
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        width={560}
        extra={
          <Space>
            <Select
              size="small"
              value={detailItem.stage}
              style={{ width: 100 }}
              onChange={(v) => handleStageChange(detailItem.id, v)}
              options={STAGES.map((s) => ({ label: s.label, value: s.key }))}
            />
            <Button icon={<EditOutlined />} onClick={() => { setDetailOpen(false); handleEdit(detailItem); }}>编辑</Button>
            <Popconfirm title="确定删除？" onConfirm={() => { handleDelete(detailItem.id); setDetailOpen(false); }}>
              <Button danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </Space>
        }
      >
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="标题">{detailItem.title}</Descriptions.Item>
          <Descriptions.Item label="阶段">
            <Tag color={st?.color}>{st?.label || detailItem.stage}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="公司名称">{detailItem.companyName}</Descriptions.Item>
          <Descriptions.Item label="联系人">{detailItem.contactName || '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{detailItem.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="电话">{detailItem.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="国家">{detailItem.country || '-'}</Descriptions.Item>
          <Descriptions.Item label="来源">{detailItem.source || '-'}</Descriptions.Item>
          <Descriptions.Item label="负责人">{detailItem.assignee?.realName || '未分配'}</Descriptions.Item>
        </Descriptions>

        {detailItem.stage === 'LEAD' && (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
            <Descriptions.Item label="感兴趣产品">{detailItem.productInterest || '-'}</Descriptions.Item>
            <Descriptions.Item label="备注">{detailItem.leadNotes || '-'}</Descriptions.Item>
          </Descriptions>
        )}
        {detailItem.stage === 'OPPORTUNITY' && (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
            <Descriptions.Item label="预估金额">{detailItem.estimatedAmount ? formatCurrency(detailItem.estimatedAmount) : '-'}</Descriptions.Item>
            <Descriptions.Item label="成交概率">{detailItem.probability ? `${detailItem.probability}%` : '-'}</Descriptions.Item>
            <Descriptions.Item label="预计成交日期">{detailItem.estimatedCloseDate || '-'}</Descriptions.Item>
          </Descriptions>
        )}
        {detailItem.stage === 'SAMPLE' && (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
            <Descriptions.Item label="样品类型">{detailItem.sampleType || '-'}</Descriptions.Item>
            <Descriptions.Item label="样品数量">{detailItem.sampleQuantity || '-'}</Descriptions.Item>
            <Descriptions.Item label="样品状态">{detailItem.sampleStatus || '-'}</Descriptions.Item>
          </Descriptions>
        )}
        {detailItem.stage === 'ORDER' && (
          <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
            <Descriptions.Item label="订单金额">{detailItem.orderAmount ? formatCurrency(detailItem.orderAmount) : '-'}</Descriptions.Item>
            <Descriptions.Item label="下单日期">{detailItem.orderDate || '-'}</Descriptions.Item>
            <Descriptions.Item label="交付日期">{detailItem.deliveryDate || '-'}</Descriptions.Item>
            <Descriptions.Item label="付款条件">{detailItem.paymentTerms || '-'}</Descriptions.Item>
            <Descriptions.Item label="订单状态">{detailItem.orderStatus || '-'}</Descriptions.Item>
          </Descriptions>
        )}

        {/* 活动日志 */}
        {detailItem.activities && detailItem.activities.length > 0 && (
          <Card title="活动记录" size="small" style={{ marginTop: 16 }}>
            {detailItem.activities.map((a) => (
              <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                <Tag color="blue" style={{ marginRight: 8 }}>{a.action}</Tag>
                {a.fromStage && <span>{STAGE_LABELS[a.fromStage]} <RightOutlined /> {STAGE_LABELS[a.toStage || '']}</span>}
                <span style={{ marginLeft: 12, color: '#94a3b8', fontSize: 11 }}>{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            ))}
          </Card>
        )}

        <div style={{ marginTop: 16 }}>
          <span style={{ color: '#94a3b8', fontSize: 12 }}>
            创建于 {new Date(detailItem.createdAt).toLocaleString('zh-CN')} | 更新于 {new Date(detailItem.updatedAt).toLocaleString('zh-CN')}
          </span>
        </div>
      </Drawer>
    );
  };

  // ============ 统计卡片 ============

  const stats = useMemo(() => {
    const result: Record<string, number> = {};
    for (const stage of STAGES) {
      const col = kanbanData[stage.key];
      result[stage.key] = col ? col.items.length : 0;
    }
    return result;
  }, [kanbanData]);

  // ============ 主渲染 ============

  return (
    <div>
      {/* 概览卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {STAGES.map((stage) => (
          <Col xs={12} sm={6} key={stage.key}>
            <Card
              variant="borderless"
              size="small"
              style={{ borderRadius: 12, cursor: 'pointer', background: stage.bg }}
              onClick={() => { setViewMode('list'); setFilterStage(stage.key); setPage(1); }}
            >
              <Statistic
                title={<span style={{ color: stage.color, fontSize: 13 }}>{stage.label}</span>}
                value={stats[stage.key] || 0}
                valueStyle={{ color: stage.color, fontSize: 24 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>新增</Button>
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>导入</Button>
        </Space>

        <Space>
          <Button
            type={viewMode === 'kanban' ? 'primary' : 'default'}
            icon={<AppstoreOutlined />}
            onClick={() => setViewMode('kanban')}
          >
            看板
          </Button>
          <Button
            type={viewMode === 'list' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('list')}
          >
            列表
          </Button>
          <Button icon={<ReloadOutlined />} onClick={refresh} />
        </Space>
      </div>

      {/* 内容区 */}
      {viewMode === 'kanban' ? <KanbanView /> : <ListView />}

      {/* 弹窗 */}
      <FormModal />
      <ImportModal />
      <DetailDrawer />
    </div>
  );
}
