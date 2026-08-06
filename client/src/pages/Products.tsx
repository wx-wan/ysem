import { useEffect, useState, useCallback } from 'react';
import {
  App, Table, Button, Input, Select, Modal, Form, Tag, Space, Upload, Popconfirm,
  Row, Col, Statistic, Tooltip, Tabs, Card, Pagination,
} from 'antd';
import {
  PlusOutlined, UploadOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  InboxOutlined, CloudServerOutlined, FileTextOutlined, RobotOutlined,
  CheckCircleFilled, CloseCircleFilled, MinusCircleFilled, ReloadOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { FormInstance } from 'antd/es/form';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { buildTablePagination } from '../components/common/tablePagination';
import {
  productApi, Product, ProductPayload, ProductQuery, ImportResult,
  PRODUCT_TYPE_LABELS, SELF_KIND_LABELS, PRODUCT_SOURCE_LABELS, PRODUCT_STATUS_LABELS,
} from '../api/products';

type TypeFilter = 'ALL' | 'SELF' | 'EXTERNAL' | 'FINISHED' | 'SEMI';
type StatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE' | 'OFFLINE';

/** 根据含税单价和税率计算不含税单价 */
function calcExclPrice(formInstance: FormInstance) {
  try {
    const price = Number(formInstance.getFieldValue('price') || 0);
    const rate = Number(formInstance.getFieldValue('taxRate') || 0);
    // 触发重渲染以更新显示
    formInstance.setFieldsValue({ _calcTick: Date.now() });
  } catch {
    /* ignore */
  }
}

export default function Products() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [data, setData] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(false);

  // 统计数据
  const [stats, setStats] = useState({ total: 0, selfCount: 0, selfFinished: 0, selfSemi: 0, externalCount: 0, inactiveCount: 0 });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 构建筛选参数
      let typeParam: string | undefined;
      if (typeFilter === 'SELF') typeParam = 'SELF';
      else if (typeFilter === 'EXTERNAL') typeParam = 'EXTERNAL';
      else if (typeFilter === 'FINISHED') typeParam = 'SELF'; // 后端按 type=SELF + 前端二次过滤
      else if (typeFilter === 'SEMI') typeParam = 'SELF';

      let statusParam: string | undefined;
      if (statusFilter === 'ACTIVE') statusParam = 'ACTIVE';
      else if (statusFilter === 'INACTIVE') statusParam = 'INACTIVE';
      else if (statusFilter === 'OFFLINE') statusParam = 'INACTIVE'; // 下架映射为 INACTIVE

      const params: ProductQuery = {
        page, pageSize,
        keyword: keyword || undefined,
        type: typeParam,
        source: undefined,
        status: statusParam,
      };
      const res = await productApi.list(params);
      if (res.data.code === 200) {
        let list = res.data.data.list;
        // FINISHED / SEMI 需前端二次过滤
        if (typeFilter === 'FINISHED') list = list.filter((p) => p.selfKind === 'FINISHED');
        if (typeFilter === 'SEMI') list = list.filter((p) => p.selfKind === 'SEMI');
        setData(list);
        setTotal(res.data.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, typeFilter, statusFilter]);

  // 加载统计数据
  const fetchStats = useCallback(async () => {
    try {
      const res = await productApi.list({ page: 1, pageSize: 9999 });
      if (res.data.code === 200) {
        const all = res.data.data.list;
        const selfProducts = all.filter((p) => p.type === 'SELF');
        setStats({
          total: all.length,
          selfCount: selfProducts.length,
          selfFinished: selfProducts.filter((p) => p.selfKind === 'FINISHED').length,
          selfSemi: selfProducts.filter((p) => p.selfKind === 'SEMI').length,
          externalCount: all.filter((p) => p.type === 'EXTERNAL').length,
          inactiveCount: all.filter((p) => p.status !== 'ACTIVE').length,
        });
      }
    } catch {
      /* 静默 */
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ type: 'SELF_FINISHED', status: 'ACTIVE', source: 'MANUAL', taxRate: 13, stock: 0, lowStockAlert: 0 });
    setModalOpen(true);
  };

  const openEdit = (record: Product) => {
    setEditing(record);
    // 将 type + selfKind 映射为复合选择值
    const typeVal = record.type === 'EXTERNAL'
      ? 'EXTERNAL'
      : record.selfKind
        ? `SELF_${record.selfKind}`
        : 'SELF_FINISHED';
    form.setFieldsValue({
      ...record,
      _typeRaw: typeVal,
      price: record.price ?? undefined,
      taxRate: record.taxRate ?? 13,
      stock: record.stock ?? 0,
      lowStockAlert: record.lowStockAlert ?? 0,
    });
    // 设置 type 为复合值以匹配 Select
    form.setFieldValue('type', typeVal);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const values = await form.validateFields();

      // 复合 type 字段映射：SELF_FINISHED → {type:'SELF',selfKind:'FINISHED'}
      let resolvedType = values.type;
      let resolvedSelfKind = values.selfKind;
      if (typeof values.type === 'string' && values.type.startsWith('SELF_')) {
        resolvedType = 'SELF';
        resolvedSelfKind = values.type.replace('SELF_', '');
      }

      const payload: ProductPayload = {
        ...values,
        type: resolvedType as any,
        selfKind: resolvedType === 'EXTERNAL' ? null : (resolvedSelfKind || null),
        price: values.price ? Number(values.price) : null,
        taxRate: values.taxRate != null ? Number(values.taxRate) : undefined,
        stock: values.stock != null ? Number(values.stock) : undefined,
        lowStockAlert: values.lowStockAlert != null ? Number(values.lowStockAlert) : undefined,
      };
      // 删除内部临时字段
      delete (payload as any)._typeRaw;
      delete (payload as any)._calcTick;

      if (editing) {
        const res = await productApi.update(editing.id, payload);
        if (res.data.code === 200) message.success('更新成功');
      } else {
        const res = await productApi.create(payload);
        if (res.data.code === 200) message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
      fetchStats();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const res = await productApi.remove(id);
    if (res.data.code === 200) {
      message.success('删除成功');
      fetchData();
      fetchStats();
    } else {
      message.error(res.data.message || '删除失败');
    }
  };

  const handleBatchDelete = async (ids: React.Key[]) => {
    const res = await productApi.batchRemove(ids as string[]);
    if (res.data.code === 200) {
      message.success('批量删除成功');
      fetchData();
      fetchStats();
    }
  };

  // ============ 导入 ============
  const handleImportFile = async (file: File) => {
    setImporting(true);
    try {
      const res = await productApi.import(file);
      if (res.data.code === 200) {
        const r: ImportResult = res.data.data;
        if (r.errors.length > 0) {
          message.warning(`导入完成：成功 ${r.success}/${r.total}，失败 ${r.errors.length} 条`);
        } else {
          message.success(`导入成功 ${r.success}/${r.total}`);
        }
        setImportOpen(false);
        fetchData();
        fetchStats();
      } else {
        message.error(res.data.message || '导入失败');
      }
    } finally {
      setImporting(false);
    }
  };

  const handleSync = async () => {
    const res = await productApi.syncPlatform();
    if (res.data.code === 200) {
      message.info(res.data.data.message || '同步通道待接入');
    }
  };

  // ============ 表格列定义 ============
  const columns: ColumnsType<Product> = [
    {
      title: '产品', dataIndex: 'name', key: 'name', fixed: 'left', width: 260,
      render: (name: string, r: Product) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: token.colorText }}>{name}</div>
          {r.sku && (
            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>{r.sku}</div>
          )}
        </div>
      ),
    },
    {
      title: '类型', key: 'typeTag', width: 110,
      render: (_: unknown, r: Product) => {
        if (r.type === 'SELF') {
          return (
            <Tag
              color="blue"
              style={{ borderRadius: token.borderRadiusSM, fontWeight: 500 }}
            >
              自·{r.selfKind ? SELF_KIND_LABELS[r.selfKind] : '产品'}
            </Tag>
          );
        }
        return (
          <Tag
            color="orange"
            style={{ borderRadius: token.borderRadiusSM, fontWeight: 500 }}
          >
            外购品
          </Tag>
        );
      },
    },
    {
      title: '规格', dataIndex: 'spec', key: 'spec', width: 220,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: '含税单价', key: 'price', width: 120,
      render: (_: unknown, r: Product) =>
        r.price != null ? (
          <span style={{ fontWeight: 600 }}>
            ¥{Number(r.price).toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
          </span>
        ) : '-',
    },
    {
      title: '库存', dataIndex: 'unit', key: 'stock', width: 80,
      align: 'center',
      render: (_v: string | null) => (
        <span style={{ color: token.colorTextSecondary }}>-</span>
      ),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      align: 'center',
      render: (s: Product['status']) => (
        <Tag
          color={s === 'ACTIVE' ? 'green' : 'default'}
          style={{ borderRadius: token.borderRadiusSM }}
        >
          {s === 'ACTIVE' ? '在售' : '停用'}
        </Tag>
      ),
    },
    {
      title: '来源', dataIndex: 'source', key: 'source', width: 110,
      render: (s: Product['source']) =>
        s === 'SYNC' ? (
          <a onClick={handleSync} style={{ cursor: 'pointer' }}>平台同步</a>
        ) : s === 'RPA' ? (
          <a style={{ color: '#7c3aed', cursor: 'pointer' }}>文件导入</a>
        ) : (
          <span style={{ color: token.colorTextSecondary }}>手动录入</span>
        ),
    },
    {
      title: '', key: 'action', fixed: 'right', width: 100,
      render: (_: unknown, r: Product) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Popconfirm title="确认删除该产品？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消">
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rowSelection = {
    onChange: (keys: React.Key[]) => setSelectedRowKeys(keys),
  };
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 统计卡片样式
  const statCardStyle: React.CSSProperties = {
    background: token.colorBgContainer,
    borderRadius: token.borderRadiusLG,
    padding: '16px 20px',
    border: `1px solid ${token.colorBorderSecondary}`,
  };

  return (
    <div style={{ minHeight: '100%' }}>
      {/* 页面标题行 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: token.colorText }}>{t('menu.products')}</h1>
        <Space>
          <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
            导入产品
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建产品
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col span={6}>
          <div style={statCardStyle}>
            <Statistic
              title={<span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 400 }}>产品总数</span>}
              value={stats.total}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: token.colorText } }}
              suffix={
                <span style={{ fontSize: 12, color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4 }}>
                  在库 {stats.total - stats.inactiveCount} 件
                </span>
              }
            />
          </div>
        </Col>
        <Col span={6}>
          <div style={statCardStyle}>
            <Statistic
              title={<span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 400 }}>自产品</span>}
              value={stats.selfCount}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: token.colorText } }}
              suffix={
                <span style={{ fontSize: 12, color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4 }}>
                  成品 {stats.selfFinished} · 半成品 {stats.selfSemi}
                </span>
              }
            />
          </div>
        </Col>
        <Col span={6}>
          <div style={statCardStyle}>
            <Statistic
              title={<span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 400 }}>外购品</span>}
              value={stats.externalCount}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: token.colorText } }}
              suffix={
                <span style={{ fontSize: 12, color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4 }}>
                  家供应商
                </span>
              }
            />
          </div>
        </Col>
        <Col span={6}>
          <div style={statCardStyle}>
            <Statistic
              title={<span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 400 }}>库存预警</span>}
              value={stats.inactiveCount}
              styles={{ content: { fontSize: 28, fontWeight: 700, color: stats.inactiveCount > 0 ? token.colorError : token.colorText } }}
              suffix={
                <span style={{ fontSize: 12, color: token.colorTextTertiary, fontWeight: 400, marginLeft: 4 }}>
                  库存无货
                </span>
              }
            />
          </div>
        </Col>
      </Row>

      {/* 工具栏 + 表格 */}
      <div style={{
        background: token.colorBgContainer,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        overflow: 'hidden',
      }}>
        {/* 搜索与筛选栏 */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px dashed ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <Input
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            placeholder="搜索名称、SKU、规格..."
            style={{ width: 240 }}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => setPage(1)}
          />
          <Select
            value={typeFilter}
            style={{ width: 120 }}
            onChange={(v) => { setTypeFilter(v); setPage(1); }}
            options={[
              { label: '全部类型', value: 'ALL' },
              { label: '成品', value: 'FINISHED' },
              { label: '半成品', value: 'SEMI' },
              { label: '外购品', value: 'EXTERNAL' },
            ]}
          />
          <Select
            value={statusFilter}
            style={{ width: 100 }}
            onChange={(v) => { setStatusFilter(v); setPage(1); }}
            options={[
              { label: '全部状态', value: 'ALL' },
              { label: '在售', value: 'ACTIVE' },
              { label: '停用', value: 'INACTIVE' },
              { label: '下架', value: 'OFFLINE' },
            ]}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: token.colorTextTertiary }}>
            {total} 件产品
          </span>
        </div>

        {/* 表格 */}
        <div
          style={{
            background: token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            overflow: 'hidden',
          }}
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={data}
            loading={loading}
            scroll={{ x: 960 }}
            rowSelection={rowSelection}
            pagination={false}
            title={() => selectedRowKeys.length > 0 ? (
              <div style={{ padding: '8px 16px', background: token.colorFillAlter, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                <Popconfirm
                  title={`确认删除选中的 ${selectedRowKeys.length} 个产品？`}
                  onConfirm={() => handleBatchDelete(selectedRowKeys)}
                  okText="删除"
                  cancelText="取消"
                >
                  <Button danger size="small">批量删除（{selectedRowKeys.length}）</Button>
                </Popconfirm>
              </div>
            ) : undefined}
            size="middle"
          />
        </div>

        {/* 分页 */}
        {total > pageSize && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
            <Pagination
              {...buildTablePagination({
                total, page, pageSize,
                onChange: (p, ps) => { setPage(p); setPageSize(ps); },
              })}
            />
          </div>
        )}
      </div>

      {/* 新增 / 编辑 弹窗（4 区块布局） */}
      <Modal
        title={editing ? '编辑产品' : '新建产品'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建产品'}
        cancelText="取消"
        width={640}
        styles={{ body: { paddingTop: 20 } }}
      >
        <Form form={form} layout="vertical" preserve={false} initialValues={{ type: 'SELF', status: 'ACTIVE', source: 'MANUAL', taxRate: 13, stock: 0, lowStockAlert: 0 }}>

          {/* 区块 1 — 基本信息 */}
          <div style={{ fontSize: 13, fontWeight: 600, color: token.colorTextSecondary, marginBottom: 12 }}>基本信息</div>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
                <Input placeholder="产品名称" />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="sku" label="SKU 编号" rules={[{ required: true, message: '请输入 SKU 编号' }]}>
                <Input placeholder="SKU-XXXX" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="type" label="产品类型" rules={[{ required: true }]}>
                <Select
                  options={[
                    { label: '自产品-成品', value: 'SELF_FINISHED' },
                    { label: '自产品-半成品', value: 'SELF_SEMI' },
                    { label: '外购品', value: 'EXTERNAL' },
                  ]}
                  onChange={(val) => {
                    if (val === 'EXTERNAL') {
                      form.setFieldsValue({ selfKind: undefined });
                    } else if (val === 'SELF_FINISHED') {
                      form.setFieldsValue({ selfKind: 'FINISHED' });
                    } else if (val === 'SELF_SEMI') {
                      form.setFieldsValue({ selfKind: 'SEMI' });
                    }
                    // 映射回实际存储值
                    const realType = val.startsWith('SELF') ? 'SELF' : 'EXTERNAL';
                    form.setFieldValue('_typeRaw', val);
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="spec" label="规格型号">
                <Input placeholder="如：2U/32核/256GB" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="unit" label="计量单位" rules={[{ required: true, message: '请选择计量单位' }]}>
                <Select
                  showSearch
                  placeholder="选择"
                  options={[
                    { label: '个', value: '个' }, { label: '套', value: '套' }, { label: '箱', value: '箱' },
                    { label: '台', value: '台' }, { label: '件', value: '件' }, { label: '批', value: '批' },
                    { label: '米', value: '米' }, { label: '千克', value: '千克' }, { label: '升', value: '升' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>

          {/* 区块 2 — 产品描述 */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: token.colorTextSecondary,
            marginTop: 16, marginBottom: 12,
            borderTop: `1px dashed ${token.colorBorderSecondary}`, paddingTop: 16,
          }}>
            产品描述
          </div>
          <Form.Item name="description">
            <Input.TextArea rows={3} placeholder="产品用途、特性说明..." />
          </Form.Item>

          {/* 区块 3 — 价格与税务 */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: token.colorTextSecondary,
            marginTop: 4, marginBottom: 12,
            borderTop: `1px dashed ${token.colorBorderSecondary}`, paddingTop: 16,
          }}>
            价格与税务
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="price" label="含税单价（元）" rules={[{ required: true, message: '请输入含税单价' }]}>
                <Input
                  type="number"
                  prefix={<span style={{ color: token.colorTextTertiary }}>¥</span>}
                  placeholder="0.00"
                  onChange={() => calcExclPrice(form)}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="taxRate" label="税率">
                <Select
                  options={[
                    { label: '0%', value: 0 },
                    { label: '1%', value: 1 },
                    { label: '3%', value: 3 },
                    { label: '6%', value: 6 },
                    { label: '9%', value: 9 },
                    { label: '13%', value: 13 },
                  ]}
                  onChange={() => calcExclPrice(form)}
                />
              </Form.Item>
            </Col>
          </Row>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            background: token.colorFillAlter,
            borderRadius: token.borderRadiusSM,
            marginBottom: 8,
          }}>
            <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>不含税单价</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>
              ¥{(() => {
                try {
                  const price = Number(form.getFieldValue('price') || 0);
                  const rate = Number(form.getFieldValue('taxRate') || 0);
                  return (price / (1 + rate / 100)).toFixed(2);
                } catch { return '0.00'; }
              })()}
            </span>
            <Tooltip title="重新计算">
              <ReloadOutlined
                style={{ color: token.colorTextTertiary, cursor: 'pointer' }}
                onClick={() => calcExclPrice(form)}
              />
            </Tooltip>
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>自动计算</span>
          </div>

          {/* 区块 4 — 库存管理 & 产品状态 */}
          <div style={{
            fontSize: 13, fontWeight: 600, color: token.colorTextSecondary,
            marginTop: 4, marginBottom: 12,
            borderTop: `1px dashed ${token.colorBorderSecondary}`, paddingTop: 16,
          }}>
            库存管理
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="stock" label="当前库存" rules={[{ required: true }]}>
                <Input type="number" placeholder="0" min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="lowStockAlert" label="最低库存预警">
                <Input type="number" placeholder="0" min={0} />
              </Form.Item>
            </Col>
          </Row>

          <div style={{
            fontSize: 13, fontWeight: 600, color: token.colorTextSecondary,
            marginTop: 16, marginBottom: 12,
            borderTop: `1px dashed ${token.colorBorderSecondary}`, paddingTop: 16,
          }}>
            产品状态
          </div>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label="销售状态">
                <Select options={[
                  { label: '在售', value: 'ACTIVE' },
                  { label: '停用', value: 'INACTIVE' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source" label="数据来源">
                <Select options={[
                  { label: '手动录入', value: 'MANUAL' },
                  { label: '平台同步', value: 'SYNC' },
                  { label: 'RPA 导入', value: 'RPA' },
                ]} />
              </Form.Item>
            </Col>
          </Row>

        </Form>
      </Modal>

      {/* 导入产品弹窗（三 Tab：平台同步 / 文件导入 / RPA 导入） */}
      <Modal
        title="导入产品"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={null}
        width={680}
      >
        <Tabs
          defaultActiveKey="sync"
          items={[
            {
              key: 'sync',
              label: '平台同步',
              children: <ImportSyncTab token={token} onRefresh={() => { fetchData(); fetchStats(); }} />,
            },
            {
              key: 'file',
              label: '文件导入',
              children: <ImportFileTab
                importing={importing}
                onImport={handleImportFile}
                token={token}
              />,
            },
            {
              key: 'rpa',
              label: 'RPA 导入',
              children: <ImportRpaTab token={token} onRefresh={() => { fetchData(); fetchStats(); }} />,
            },
          ]}
          style={{ marginTop: 8 }}
        />
      </Modal>
    </div>
  );
}

// ============ 导入子组件 ============

/** 平台同步 Tab */
function ImportSyncTab({ token, onRefresh }: { token: any; onRefresh: () => void }) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState<string | null>(null);

  // 平台列表（预留数据结构，后续对接真实平台 API）
  const platforms = [
    { id: 'jd', name: '京东企业购', count: 142, connected: true },
    { id: 'alibaba', name: '阿里巴巴B2B', count: 87, connected: true },
    { id: 'huicong', name: '慧聪网', count: null, connected: false },
  ];

  const handleAction = (platformId: string, connected: boolean) => {
    if (connected) {
      setLoading(platformId);
      // TODO: 调用后端 /api/products/sync?platform=xxx 触发同步
      setTimeout(() => {
        setLoading(null);
        message.success('已发起同步，产品将在后台拉取');
        onRefresh();
      }, 1200);
    } else {
      message.info(`连接「${platforms.find((p) => p.id === platformId)?.name}」功能开发中`);
    }
  };

  return (
    <div>
      <p style={{ color: token.colorTextSecondary, fontSize: 13, marginBottom: 20 }}>
        选择平台后查看可同步的产品列表。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {platforms.map((p) => (
          <Card
            key={p.id}
            size="small"
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
              transition: 'border-color 0.2s',
            }}
            styles={{ body: { padding: '16px 20px' } }}
            hoverable
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: p.connected ? '#10b981' : token.colorBorderSecondary,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>
                    {p.connected
                      ? `${p.count} 件产品可同步`
                      : '未连接'}
                  </div>
                </div>
              </div>
              <Button
                onClick={() => handleAction(p.id, p.connected)}
                loading={loading === p.id}
              >
                {p.connected ? '查看产品' : '连接平台'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/** 文件导入 Tab */
function ImportFileTab({
  importing, onImport, token,
}: {
  importing: boolean;
  onImport: (file: File) => void;
  token: any;
}) {
  const { message } = App.useApp();
  const downloadTemplate = () => {
    message.info('模板下载功能开发中');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: token.colorTextSecondary, fontSize: 13 }}>
          支持 .xlsx、.csv 格式，单次最多 1000 条。
        </span>
        <a onClick={downloadTemplate} style={{ cursor: 'pointer' }}>下载导入模板</a>
      </div>

      <Upload.Dragger
        accept=".xlsx,.xls,.csv"
        showUploadList={false}
        beforeUpload={(file) => { onImport(file); return false; }}
        maxCount={1}
        style={{
          borderStyle: 'dashed',
          borderColor: token.colorBorderSecondary,
          background: token.colorBgContainer,
          borderRadius: token.borderRadiusLG,
          padding: '48px 0',
        }}
      >
        <InboxOutlined style={{ fontSize: 36, color: token.colorTextTertiary }} />
        <p style={{ marginTop: 16, marginBottom: 4, color: token.colorText, fontSize: 14 }}>
          拖拽文件至此处，或{' '}
          <a style={{ cursor: 'pointer' }}>点击选择文件</a>
        </p>
        <p style={{ color: token.colorTextTertiary, fontSize: 12, margin: 0 }}>
          .xlsx / .csv，最大 10MB
        </p>
      </Upload.Dragger>
    </div>
  );
}

/** RPA 导入 Tab */
function ImportRpaTab({ token, onRefresh }: { token: any; onRefresh: () => void }) {
  const { message } = App.useApp();
  const [executing, setExecuting] = useState<string | null>(null);

  // RPA 任务列表（预留数据，后续对接后端任务管理）
  const rpaTasks = [
    {
      id: 'erp-sync',
      name: 'ERP 产品目录同步',
      system: 'SAP ERP 系统',
      status: 'success' as const,
      lastRun: '2026-07-30 09:15',
      count: 23,
    },
    {
      id: 'purchase-parse',
      name: '采购报价单解析',
      system: '邮箱附件',
      status: 'success' as const,
      lastRun: '2026-07-28 14:30',
      count: 11,
    },
    {
      id: 'price-monitor',
      name: '电商平台价格监控',
      system: '多平台爬虫',
      status: 'failed' as const,
      lastRun: '2026-07-25 08:00',
      count: null,
      error: '目标站点反爬机制触发，访问超时',
    },
  ];

  const handleExecute = (taskId: string) => {
    setExecuting(taskId);
    setTimeout(() => {
      setExecuting(null);
      message.success('RPA 任务已触发执行');
      onRefresh();
    }, 1500);
  };

  return (
    <div>
      <p style={{ color: token.colorTextSecondary, fontSize: 13, marginBottom: 20 }}>
        已配置的 RPA 任务将自动从数据源抓取产品信息并导入产品库。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rpaTasks.map((task) => (
          <Card
            key={task.id}
            size="small"
            style={{
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${token.colorBorderSecondary}`,
            }}
            styles={{ body: { padding: '16px 20px' } }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{task.name}</span>
                  {task.status === 'success' ? (
                    <Tag color="success" style={{ margin: 0, borderRadius: 10, fontSize: 11 }}>成功</Tag>
                  ) : task.status === 'failed' ? (
                    <Tag color="error" style={{ margin: 0, borderRadius: 10, fontSize: 11 }}>失败</Tag>
                  ) : (
                    <Tag style={{ margin: 0, borderRadius: 10, fontSize: 11 }}>运行中</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>{task.system}</div>
                <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>
                  上次执行：{task.lastRun}
                  {task.count != null ? `  同步 ${task.count} 件` : ''}
                </div>
                {task.error && (
                  <div style={{ fontSize: 12, color: token.colorError, marginTop: 6 }}>
                    {task.error}
                  </div>
                )}
              </div>
              <Button
                style={{ marginLeft: 16, flexShrink: 0 }}
                onClick={() => handleExecute(task.id)}
                loading={executing === task.id}
              >
                {task.status === 'failed' ? '重试' : '立即执行'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
