import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Card, Button, Space, Input, Select, Table, Tag, Popconfirm, App, Upload, Tabs, Modal,
  Statistic, Row, Col, Pagination,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, DeleteOutlined,
  AppstoreOutlined, UnorderedListOutlined, ImportOutlined,
  InboxOutlined, EditOutlined, EyeOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { theme } from 'antd';
import { salesApi, SalesItem } from '../api/sales';
import { customerApi, Customer } from '../api/customers';
import SalesFormModal from '../components/sales/SalesFormModal';
import SalesDetailDrawer from '../components/sales/SalesDetailDrawer';
import { useTranslation } from 'react-i18next';
import { SALES_STAGES, getStageMeta, getStageI18nKey, type SalesStage } from '../components/sales/stages';
import { buildTablePagination } from '../components/common/tablePagination';
import KanbanView from '../components/sales/KanbanView';
import Price from '../components/common/Price';

export default function Sales({ fixedStage }: { fixedStage?: SalesStage }) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();

  // 阶段选项：由后端按关联单据派生，仅用于展示与筛选
  const stageOptions = SALES_STAGES.map((s) => ({
    value: s,
    label: t(`sales.stage.${getStageI18nKey(s)}`),
    color: getStageMeta(s).color,
    bg: getStageMeta(s).bg,
    border: getStageMeta(s).border,
  }));

  // 视图模式
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>(fixedStage ? 'list' : 'kanban');

  // 数据状态
  const [kanbanData, setKanbanData] = useState<Record<string, { title: string; items: SalesItem[] }>>({});
  const [listData, setListData] = useState<SalesItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterStage, setFilterStage] = useState<string>(fixedStage ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(19);

  // 弹窗状态
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SalesItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState('excel');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<SalesItem | null>(null);
  const [assignUsers, setAssignUsers] = useState<{ id: string; realName: string }[]>([]);
  const [customerOptions, setCustomerOptions] = useState<{ label: string; value: string; raw: Customer }[]>([]);

  // ============ 数据加载 ============

  const fetchKanban = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await salesApi.kanban(signal);
      setKanbanData(res.data.data.columns);
    } catch {
      // 忽略取消/异常
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchList = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
      if (keyword) params.keyword = keyword;
      if (filterStage) params.stage = filterStage;
      const res = await salesApi.list(params, signal);
      setListData(res.data.data.list);
      setTotal(res.data.data.total);
    } catch {
      // 忽略取消/异常
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

  const fetchCustomers = async () => {
    try {
      const res = await customerApi.options();
      setCustomerOptions(
        (res.data.data || []).map((c: Customer) => ({ label: c.companyName, value: c.id, raw: c }))
      );
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const controller = new AbortController();
    if (viewMode === 'kanban') fetchKanban(controller.signal);
    else fetchList(controller.signal);
    return () => controller.abort();
  }, [viewMode, fetchKanban, fetchList]);

  const refresh = () => {
    if (viewMode === 'kanban') fetchKanban();
    else fetchList();
  };

  // 从线索页「前往查看」跳转过来时，携带 ?pipelineId= 自动打开对应商机详情抽屉
  useEffect(() => {
    const pipelineId = searchParams.get('pipelineId');
    if (!pipelineId) return;
    (async () => {
      try {
        const res = await salesApi.get(pipelineId);
        setDetailItem(res.data.data);
        setDetailOpen(true);
      } catch {
        // 找不到则不打开，停留在列表
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // ============ 操作 ============

  // 阶段由后端派生，新建时不再指定阶段
  const handleCreate = () => {
    setEditingItem(null);
    fetchAssignUsers();
    fetchCustomers();
    setModalOpen(true);
  };

  const handleEdit = (item: SalesItem) => {
    setEditingItem(item);
    fetchAssignUsers();
    setModalOpen(true);
  };

  const handleFormSuccess = async (values: any) => {
    try {
      if (editingItem) {
        await salesApi.update(editingItem.id, values);
        message.success('保存成功');
      } else {
        await salesApi.create(values);
        message.success('创建成功');
      }
      refresh();
    } catch {
      message.error('保存失败，请重试');
    }
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
    { title: t('sales.title_field'), dataIndex: 'title', width: 180, ellipsis: true },
    { title: t('sales.companyName'), dataIndex: 'companyName', width: 140 },
    { title: t('sales.contactName'), dataIndex: 'contactName', width: 100 },
    {
      title: t('sales.stage.label'), dataIndex: 'stage', width: 90,
      render: (s: string) => {
        const st = getStageMeta(s);
        return (
          <Tag color={st?.color} variant="filled">
            {t(`sales.stage.${getStageI18nKey(s)}`)}
          </Tag>
        );
      },
    },
    {
      title: t('sales.amount'), dataIndex: 'estimatedAmount', width: 120,
      render: (_: unknown, r: SalesItem) => {
        const amt = r.stage === 'ORDER' || r.stage === 'SHIPPED' ? r.orderAmount : r.estimatedAmount;
        return amt ? <Price value={amt} /> : '-';
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
          <Button size="small" type="link" icon={<EyeOutlined />} onClick={() => handleViewDetail(r.id)}>
            {t('sales.detail')}
          </Button>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => handleEdit(r)}>
            {t('common.edit')}
          </Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ], [t]);

  // ============ 列表视图 ============

  const ListView = () => (
    <>
      <Card
        variant="borderless"
        style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}
      >
      {/* 顶部添加区块：与表格风格统一，对齐客户页工具栏节奏 */}
      <div
        onClick={() => handleCreate()}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12, padding: '14px 18px', marginBottom: 16,
          borderRadius: token.borderRadius, cursor: 'pointer',
          background: `linear-gradient(90deg, ${token.colorPrimaryBg} 0%, ${token.colorPrimaryBgHover} 100%)`,
          border: `1px dashed ${token.colorPrimary}`,
          transition: 'all .2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderStyle = 'solid';
          e.currentTarget.style.boxShadow = `0 2px 12px ${token.colorPrimaryBg}`;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderStyle = 'dashed';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <Space size={10}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 8,
              background: token.colorPrimary, color: '#fff', fontSize: 16,
            }}
          >
            <PlusOutlined />
          </span>
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>
              {t('sales.newRecord')}
            </div>
            <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
              {t('sales.newRecordDesc')}
            </div>
          </div>
        </Space>
        <Space size={8} onClick={(e) => e.stopPropagation()}>
          <Button size="small" type="primary" onClick={() => handleCreate()}>
            {t('common.add')}
          </Button>
        </Space>
      </div>

      {/* 搜索与筛选栏：对齐客户页工具栏（白卡内 dashed 底边框） */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: `1px dashed ${token.colorBorderSecondary}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 8, flexWrap: 'wrap', marginBottom: 16,
        }}
      >
        <Space wrap>
          <Select
            style={{ width: 130 }}
            placeholder={t('sales.filterStage')}
            allowClear
            value={filterStage || undefined}
            onChange={(v) => { setFilterStage(v || ''); setPage(1); }}
            options={stageOptions}
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
        size="middle"
        rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
        scroll={{ x: 1000 }}
        pagination={false}
      />
    </Card>

    {total > pageSize && (
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
        <Pagination
          {...buildTablePagination({
            total, page, pageSize,
            onChange: (p, s) => { setPage(p); setPageSize(s); },
          })}
        />
      </div>
    )}
    </>
  );

  // ============ 统计卡片 ============

  const stats = useMemo(() => {
    const result: Record<string, number> = {};
    for (const stage of stageOptions) {
      const col = kanbanData[stage.value];
      result[stage.value] = col ? col.items.length : 0;
    }
    return result;
  }, [kanbanData, stageOptions]);

  // ============ 主渲染 ============

  return (
    <div>
      {/* 概览卡片 */}
      {!fixedStage && (
      <Row gutter={16} style={{ marginBottom: 16 }}>
        {stageOptions.map((stage) => (
          <Col xs={12} sm={6} key={stage.value}>
            <Card
              variant="borderless"
              size="small"
              style={{ borderRadius: 16, cursor: 'pointer', background: stage.bg, border: '1px solid transparent', transition: 'border-color .2s' }}
              hoverable
              onClick={() => { setViewMode('list'); setFilterStage(stage.value); setPage(1); }}
            >
              <Statistic
                title={<span style={{ color: stage.color, fontSize: 13 }}>{stage.label}</span>}
                value={stats[stage.value] || 0}
                styles={{ content: { color: stage.color, fontSize: 26, fontWeight: 700 } }}
              />
            </Card>
          </Col>
        ))}
      </Row>
      )}

      {/* 工具栏 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => handleCreate()}>{t('common.add')}</Button>
          {!fixedStage && (
          <Button icon={<ImportOutlined />} onClick={() => setImportOpen(true)}>{t('sales.import')}</Button>
          )}
        </Space>

        <Space>
          {!fixedStage && (
          <>
          <Button
            type={viewMode === 'kanban' ? 'primary' : 'default'}
            icon={<AppstoreOutlined />}
            onClick={() => setViewMode('kanban')}
          >
            {t('sales.kanban')}
          </Button>
          <Button
            type={viewMode === 'list' ? 'primary' : 'default'}
            icon={<UnorderedListOutlined />}
            onClick={() => setViewMode('list')}
          >
            {t('sales.list')}
          </Button>
          </>
          )}
          <Button icon={<ReloadOutlined />} onClick={refresh} />
        </Space>
      </div>

      {/* 内容区 */}
      {viewMode === 'kanban' ? (
        <KanbanView
          kanbanData={kanbanData}
          onViewDetail={handleViewDetail}
          onAdd={() => handleCreate()}
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
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('sales.importFieldsTitle')}</div>
                  <div>{t('sales.importFieldsBasic')}</div>
                  <div>{t('sales.importFieldsOpp')}</div>
                  <div>{t('sales.importFieldsOrder')}</div>
                  <div style={{ marginTop: 6, color: token.colorWarning }}>{t('sales.importStageNote')}</div>
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
        onClose={() => { setModalOpen(false); setEditingItem(null); }}
        onSaved={() => { setModalOpen(false); setEditingItem(null); refresh(); }}
      />
      <SalesDetailDrawer
        open={detailOpen}
        detailItem={detailItem}
        onClose={() => { setDetailOpen(false); setDetailItem(null); }}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />
    </div>
  );
}
