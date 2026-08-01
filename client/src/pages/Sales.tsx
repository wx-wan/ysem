import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Upload, Tabs, Modal,
  Statistic, Row, Col,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  AppstoreOutlined, UnorderedListOutlined, ImportOutlined,
  InboxOutlined, EditOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { theme } from 'antd';
import { salesApi, SalesItem } from '../api/sales';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import SalesFormModal from '../components/sales/SalesFormModal';
import SalesDetailDrawer from '../components/sales/SalesDetailDrawer';
import StageButtons, { STAGES } from '../components/sales/StageButtons';
import { getStage } from '../components/sales/stages';
import KanbanView from '../components/sales/KanbanView';

export default function Sales() {
  const { message } = App.useApp();
  const { format: formatCurrency } = useCurrencyStore();
  const { token } = theme.useToken();

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
  const [initialFormStage, setInitialFormStage] = useState<string>('LEAD');
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('excel');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<SalesItem | null>(null);
  const [assignUsers, setAssignUsers] = useState<{ id: string; realName: string }[]>([]);

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
    setInitialFormStage('LEAD');
    fetchAssignUsers();
    setModalOpen(true);
  };

  const handleEdit = (item: SalesItem) => {
    setEditingItem(item);
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

  // ============ 表格列定义 ============

  const columns: ColumnsType<SalesItem> = useMemo(() => [
    { title: '标题', dataIndex: 'title', width: 180, ellipsis: true },
    { title: '公司', dataIndex: 'companyName', width: 140 },
    { title: '联系人', dataIndex: 'contactName', width: 100 },
    {
      title: '阶段', dataIndex: 'stage', width: 90,
      render: (s: string) => {
        const st = getStage(s);
        return <Tag color={st?.tagColor} bordered={false}>{st?.label || s}</Tag>;
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
          <StageButtons item={r} onStageChange={handleStageChange} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [formatCurrency]);

  // ============ 列表视图 ============

  const ListView = () => (
    <Card variant="borderless" style={{ borderRadius: 16 }}>
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
              style={{ borderRadius: 16, cursor: 'pointer', background: stage.bg, border: '1px solid transparent', transition: 'border-color .2s' }}
              hoverable
              onClick={() => { setViewMode('list'); setFilterStage(stage.key); setPage(1); }}
            >
              <Statistic
                title={<span style={{ color: stage.color, fontSize: 13 }}>{stage.label}</span>}
                value={stats[stage.key] || 0}
                valueStyle={{ color: stage.color, fontSize: 26, fontWeight: 700 }}
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
      {viewMode === 'kanban' ? (
        <KanbanView
          kanbanData={kanbanData}
          formatCurrency={formatCurrency}
          onViewDetail={handleViewDetail}
          onStageChange={handleStageChange}
          onAdd={(stage) => { setEditingItem(null); fetchAssignUsers(); setInitialFormStage(stage); setModalOpen(true); }}
        />
      ) : <ListView />}

      {/* 导入弹窗 */}
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
                  <p style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                    支持 .xlsx / .xls / .csv 格式
                  </p>
                </Upload.Dragger>
                <div style={{ marginTop: 16, padding: '12px 16px', background: token.colorFillQuaternary, borderRadius: 12, fontSize: 12, color: token.colorTextSecondary }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>表头字段参考：</div>
                  <div>标题、公司名称、联系人、邮箱、电话、国家、阶段、来源、产品兴趣</div>
                  <div>预估金额、预计成交日期、成交概率、样品类型、样品数量、样品状态</div>
                  <div>订单金额、订单日期、交付日期、付款条件、订单状态</div>
                  <div style={{ marginTop: 6, color: token.colorWarning }}>阶段可选值：线索 / 商机 / 样品单 / 订单</div>
                </div>
              </div>
            ),
          },
          {
            key: 'xiaoman',
            label: '小满 API',
            children: (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <InboxOutlined style={{ fontSize: 48, color: token.colorTextTertiary, marginBottom: 16 }} />
                <p style={{ color: token.colorTextSecondary }}>小满 API 对接功能开发中</p>
                <p style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                  后续将支持通过小满开放接口自动同步客户与商机数据
                </p>
              </div>
            ),
          },
        ]} />
      </Modal>

      {/* 弹窗 */}
      <SalesFormModal
        open={modalOpen}
        editingItem={editingItem}
        assignUsers={assignUsers}
        initialStage={initialFormStage}
        onClose={() => { setModalOpen(false); setEditingItem(null); }}
        onSuccess={refresh}
        api={{ create: salesApi.create, update: salesApi.update }}
      />
      <SalesDetailDrawer
        open={detailOpen}
        detailItem={detailItem}
        onClose={() => { setDetailOpen(false); setDetailItem(null); }}
        onStageChange={handleStageChange}
        onEdit={handleEdit}
        onDelete={handleDelete}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}
