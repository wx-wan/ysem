import React, { useEffect, useState } from 'react';
import {
  Button, Space, Input, Modal, Form, Select,
  Tag, Popconfirm, App, Card, Row, Col, Typography, Divider, Pagination, Skeleton,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, ReloadOutlined, CheckCircleFilled, ArrowLeftOutlined,
} from '@ant-design/icons';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory,
  taxonomyApi,
} from '../api/products';
import { certificateApi, Certificate } from '../api/certificates';
import ProductImageList from '../components/common/ProductImageList';
import { parseImages, mainImageUrl } from '../utils/productImages';
import ViewModeSwitch from '../components/common/ViewModeSwitch';
import ProductList from '../components/product/list/ProductList';
import { useAuthStore } from '../stores/useAuthStore';

const { Text } = Typography;

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// 供货模式选项
export const SUPPLY_MODES = [
  { label: '深度定制', value: 'DEEP_CUSTOM' },
  { label: '轻定制', value: 'LIGHT_CUSTOM' },
  { label: '成品现货', value: 'STOCK' },
];

// 供货模式按角色可选范围：admin 全选 / purchaser 仅轻定制+成品现货 / 其他（业务等）默认深度定制、不可修改
const SUPPLY_MODES_BY_ROLE: Record<string, string[]> = {
  admin: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'],
  purchaser: ['LIGHT_CUSTOM', 'STOCK'],
};
const DEFAULT_SUPPLY_MODE = 'DEEP_CUSTOM';

export default function Products() {
  const { message } = App.useApp();
  const [list, setList] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterCraftId, setFilterCraftId] = useState<string | undefined>();
  const [filterAudienceId, setFilterAudienceId] = useState<string | undefined>();

  // 分类下拉数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();

  // 弹窗/表单
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [form] = Form.useForm();
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  // 当前用户角色 → 供货模式可选范围（admin 全选 / purchaser 轻定制+现货 / 其他默认深度定制）
  const roleCode = useAuthStore((s) => s.user?.role?.code ?? '');
  const allowedSupplyModes = SUPPLY_MODES_BY_ROLE[roleCode] ?? [DEFAULT_SUPPLY_MODE];
  const supplyModesReadOnly = allowedSupplyModes.length <= 1; // 仅一个可用项（业务等）→ 不可修改

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await productApi.getList({
        page, pageSize, keyword,
        craftIds: filterCraftId,
        audienceId: filterAudienceId,
      });
      if (res.data.code === 200 || res.data.code === 0) {
        setList(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  const fetchTaxonomy = async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        taxonomyApi.getCrafts(),
        taxonomyApi.getAudiences(),
      ]);
      if (cRes.data.code === 200 || cRes.data.code === 0) setCrafts(cRes.data.data);
      if (aRes.data.code === 200 || aRes.data.code === 0) setAudiences(aRes.data.data);
    } catch {}
  };

  const fetchCertificates = async () => {
    try {
      const res = await certificateApi.list();
      if (res.data.code === 200 || res.data.code === 0) setCertificates(res.data.data);
    } catch {}
  };

  useEffect(() => { fetchTaxonomy(); }, []);
  useEffect(() => { fetchCertificates(); }, []);
  useEffect(() => { fetchList(); }, [page, filterCraftId, filterAudienceId]);

  // 受众变化时联动品类
  const handleAudienceChange = (audienceId?: string) => {
    setSelectedAudienceId(audienceId);
    if (audienceId) {
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
      // 回填/联动时：仅当当前品类不属于新受众的品类列表时才清空（aud 未加载时保留现值）
      try {
        const cur = form.getFieldValue('categoryId');
        if (cur && aud && !aud.categories.some((c) => c.id === cur)) form.setFieldValue('categoryId', undefined);
      } catch { /* 主表单未挂载时忽略 */ }
    } else {
      setCategories([]);
      try { form.setFieldValue('categoryId', undefined); } catch { /* 主表单未挂载时忽略 */ }
    }
  };

  // 第一步卡片式选择的状态
  const [stepOpen, setStepOpen] = useState(false);
  const [stepCrafts, setStepCrafts] = useState<ProductCraft[]>([]);
  const [stepAudience, setStepAudience] = useState<ProductAudience | undefined>();
  const [stepCategory, setStepCategory] = useState<ProductCategory | undefined>();
  const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

  // SKU 自动预览：按「工艺-受众-序号」实时请求后端生成，无需人工录入
  const [skuPreview, setSkuPreview] = useState<string>('');
  const watchedCraftIds = Form.useWatch('craftIds', form);
  const watchedAudienceId = Form.useWatch('audienceId', form);
  const watchedCategoryId = Form.useWatch('categoryId', form);
  useEffect(() => {
    const craftsKey = (watchedCraftIds ?? []).map(String).sort().join(',');
    const audId = watchedAudienceId as string | undefined;
    if (!craftsKey || !audId) { setSkuPreview(''); return; }
    // 编辑模式且工艺/受众未变化：保留原 SKU，不重新请求（避免序号 +1）
    if (editing) {
      const origCraftsKey = (editing.crafts ?? []).map((c) => c.id).sort().join(',');
      if (craftsKey === origCraftsKey && audId === editing.audienceId) {
        setSkuPreview(editing.sku || '');
        return;
      }
    }
    const t = setTimeout(async () => {
      try {
        const res = await productApi.skuPreview({ craftIds: craftsKey, audienceId: audId, excludeId: editing?.id });
        const d = res.data?.data;
        setSkuPreview(d?.sku || '');
      } catch { /* 预览失败静默，保存时由后端生成 */ }
    }, 300);
    return () => clearTimeout(t);
  }, [watchedCraftIds, watchedAudienceId, editing]);

  const resetStep = () => {
    setStepCrafts([]);
    setStepAudience(undefined);
    setStepCategory(undefined);
    setStepErr({});
    setCategories([]);
    setSelectedAudienceId(undefined);
  };

  // 已选工艺排序：左移 / 右移（顺序即提交时 craftIds 顺序）
  const moveCraft = (index: number, dir: -1 | 1) => {
    setStepCrafts((prev) => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  // 移除单个已选工艺
  const removeCraft = (id: string) => {
    setStepCrafts((prev) => prev.filter((s) => s.id !== id));
    setStepErr((e) => ({ ...e, craftId: undefined }));
  };

  const openCreate = () => {
    resetStep();
    setStepOpen(true);
  };

  const handleStepNext = async () => {
    const v = {
      // craftIds 按系统排序（taxonomy 列表已按 sort 升序返回）
      craftIds: crafts.filter((c) => stepCrafts.some((s) => s.id === c.id)).map((c) => c.id),
      audienceId: stepAudience?.id,
      categoryId: stepCategory?.id,
    };
    const err: typeof stepErr = {};
    if (!v.craftIds.length) err.craftId = '请选择工艺';
    if (!v.audienceId) err.audienceId = '请选择受众';
    // 仅当受众下存在品类时才要求选择品类
    if (selectedAudienceId && categories.length > 0 && !v.categoryId) err.categoryId = '请选择品类';
    setStepErr(err);
    if (Object.keys(err).length) return; // 校验失败：停留在第一步

    setStepOpen(false);
    setEditing(null);
    setOpen(true);
    // 主表单 Modal 已 forceRender，form 常驻连接，可直接初始化
    form.resetFields();
    form.setFieldsValue({
      ...v,
      // 新建默认：管理员/采购取首个可用模式，业务默认深度定制
      supplyModes: [allowedSupplyModes[0]],
    });
    if (v.audienceId) handleAudienceChange(v.audienceId);
  };

  const openEdit = (record: Product) => {
    setEditing(record);
    setOpen(true);
    // 主表单 Modal 已 forceRender，先重置再回填，避免残留上一次的值
    form.resetFields();
    // 供货模式按角色过滤（如采购不可含深度定制；业务固定深度定制）
    const modes = (record.supplyModes ? record.supplyModes.split(',') : [])
      .filter((m) => allowedSupplyModes.includes(m));
    form.setFieldsValue({
      ...record,
      craftIds: record.crafts?.map((c) => c.id) || [],
      supplyModes: modes.length ? modes : [allowedSupplyModes[0]],
      certificationIds: record.certificationIds ? record.certificationIds.split(',') : [],
    });
    if (record.audienceId) handleAudienceChange(record.audienceId);
  };

  // 从主表单返回第一步重新选择 工艺/受众/品类
  const backToStep = () => {
    const v = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
    setStepCrafts(crafts.filter((c) => (v.craftIds || []).includes(c.id)));
    const aud = audiences.find((a) => a.id === v.audienceId);
    setStepAudience(aud);
    const cats = aud?.categories || [];
    setCategories(cats);
    setSelectedAudienceId(v.audienceId);
    setStepCategory(cats.find((c) => c.id === v.categoryId));
    setStepErr({});
    setOpen(false);
    setStepOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 工艺/受众/品类已移至第一步选择，未渲染 Form.Item，需从 store 显式取出并入提交数据
      const extra = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
      const data = {
        ...extra,
        ...values,
        supplyModes: Array.isArray(values.supplyModes) ? values.supplyModes.join(',') : '',
        certificationIds: Array.isArray(values.certificationIds) ? values.certificationIds.join(',') : '',
      };
      if (editing) {
        await productApi.update(editing.id, data);
        message.success('更新成功');
      } else {
        await productApi.create(data);
        message.success('创建成功');
      }
      setOpen(false);
      fetchList();
    } catch { /* validation */ }
  };

  const handleDelete = async (id: string) => {
    try {
      await productApi.delete(id);
      message.success('删除成功');
      fetchList();
    } catch { message.error('删除失败'); }
  };

  return (
    <div className="pm-container">
      {/* 工具条 */}
      <Card className="pm-toolbar" styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={12} align="middle" wrap>
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="搜索产品名称 / SKU"
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onPressEnter={fetchList}
                allowClear
                style={{ width: 260 }}
              />
              <Select
                placeholder="工艺"
                value={filterCraftId}
                onChange={(v) => { setFilterCraftId(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={crafts.map((c) => ({ label: c.name, value: c.id }))}
              />
              <Select
                placeholder="受众"
                value={filterAudienceId}
                onChange={(v) => { setFilterAudienceId(v); setPage(1); }}
                allowClear
                style={{ width: 110 }}
                options={audiences.map((a) => ({ label: a.name, value: a.id }))}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchList}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setKeyword(''); setFilterCraftId(undefined); setFilterAudienceId(undefined); setPage(1); }}>重置</Button>
            </Space>
          </Col>
          <Col>
            <Space>
              <ViewModeSwitch value={viewMode} onChange={setViewMode} />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建产品</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 数据卡片网格 */}
      <Card className="pm-grid-card" styles={{ body: { padding: 20 } }}>
        {loading ? (
          <Row gutter={[16, 16]}>
            {Array.from({ length: 8 }).map((_, i) => (
              <Col key={i} xs={24} sm={12} md={12} lg={8} xl={6}>
                <div className="pm-prod-card pm-prod-card--skeleton">
                  <Skeleton active paragraph={{ rows: 4 }} title={false} />
                </div>
              </Col>
            ))}
          </Row>
        ) : list.length === 0 ? (
          <div className="pm-grid-empty">暂无产品，点击右上角「新建产品」开始添加</div>
        ) : viewMode === 'card' ? (
          <>
            <Row gutter={[16, 16]}>
              {list.map((r) => (
                <Col key={r.id} xs={24} sm={12} md={12} lg={8} xl={6}>
                  <div className="pm-prod-card">
                    {/* 渐变头 */}
                    <div className="pm-prod-cover">
                      {mainImageUrl(r.images) ? (
                        <img src={mainImageUrl(r.images)} alt="" />
                      ) : null}
                      <span className="pm-prod-sku">{r.sku || 'SKU —'}</span>
                      <span className={`pm-status pm-prod-status ${r.status === 'ACTIVE' ? 'pm-status--active' : 'pm-status--inactive'}`}>
                        {r.status === 'ACTIVE' ? '启用' : '停用'}
                      </span>
                    </div>

                    {/* 卡片体 */}
                    <div className="pm-prod-body">
                      <div className="pm-prod-name" title={r.name}>{r.name}</div>
                      <div className="pm-prod-tags">
                        {r.crafts?.length
                          ? r.crafts.map((c) => <span key={c.id} className="pm-prod-tag">{c.name}</span>)
                          : null}
                        {r.audience ? <span className="pm-prod-tag pm-prod-tag--ghost">{r.audience.name}</span> : null}
                        {r.category ? <span className="pm-prod-tag pm-prod-tag--ghost">{r.category.name}</span> : null}
                      </div>

                      <div className="pm-prod-meta">
                        <div className="pm-prod-meta-item">
                          <span className="pm-prod-meta-label">尺寸</span>
                          <span className="pm-prod-meta-val">
                            {[r.sizeL, r.sizeW, r.sizeH].filter(Boolean).join('×') || '-'}
                            {([r.sizeL, r.sizeW, r.sizeH].filter(Boolean).length ? ' cm' : '')}
                          </span>
                        </div>
                        <div className="pm-prod-meta-item">
                          <span className="pm-prod-meta-label">克重</span>
                          <span className="pm-prod-meta-val">{r.weight || '-'}{r.weight ? ' g' : ''}</span>
                        </div>
                        <div className="pm-prod-meta-item">
                          <span className="pm-prod-meta-label">单位</span>
                          <span className="pm-prod-meta-val">{r.unit || '-'}</span>
                        </div>
                      </div>

                      <div className="pm-prod-foot">
                        <div className="pm-prod-modes">
                          {r.supplyModes
                            ? r.supplyModes.split(',').map((m: string) => {
                                const f = SUPPLY_MODES.find((s) => s.value === m);
                                return f ? <span key={m} className="pm-prod-mode">{f.label}</span> : null;
                              })
                            : <span className="pm-prod-mode pm-prod-mode--ghost">未设模式</span>}
                        </div>
                        <span className="pm-actions">
                          <Button type="text" icon={<EyeOutlined />} onClick={() => { setViewing(r); setDetailOpen(true); }} />
                          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
                            <Button type="text" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </span>
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            <div className="pm-grid-pager">
              <span className="pm-grid-total">共 {total} 条</span>
              <Pagination
                current={page}
                pageSize={pageSize}
                total={total}
                showSizeChanger={false}
                onChange={(p) => setPage(p)}
              />
            </div>
          </>
        ) : (
          <ProductList
            data={list}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onView={(r) => { setViewing(r); setDetailOpen(true); }}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        )}
      </Card>

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={
          <div className="pm-modal-title">
            <span>{editing ? '编辑产品' : '新建产品'}</span>
            <span className={cx('pm-sku-preview pm-sku-head', !skuPreview && 'is-empty')}>
              {skuPreview ? (
                <>
                  <Tag color="processing" className="pm-sku-tag">自动</Tag>
                  <span>{skuPreview}</span>
                </>
              ) : 'SKU 待生成'}
            </span>
            {(() => {
              const cNames = (watchedCraftIds ?? [])
                .map((id: string) => crafts.find((c) => c.id === id)?.name)
                .filter(Boolean);
              const aName = audiences.find((a) => a.id === watchedAudienceId)?.name;
              const catName = categories.find((c) => c.id === watchedCategoryId)?.name
                || audiences.find((a) => a.id === watchedAudienceId)?.categories?.find((c) => c.id === watchedCategoryId)?.name;
              const str = [...cNames, aName, catName].filter(Boolean).join(' / ');
              return str ? <span className="pm-taxonomy-str">{str}</span> : null;
            })()}
          </div>
        }
        open={open}
        onCancel={() => setOpen(false)}
        width={1000}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>取消</Button>,
          <Button key="save" type="primary" onClick={handleSubmit}>保存</Button>,
        ]}
        // forceRender 让 form 常驻连接，打开时可直接 setFieldsValue，避免 useForm not connected 警告
        forceRender
        styles={{
          body: { paddingTop: 12 },
        }}
      >
        <Form form={form} layout="vertical" className="pm-form">
          <Row gutter={24}>
            {/* 左：产品图片栏 */}
            <Col xs={24} xl={{ flex: '3 1 0%' }} className="pm-col-stretch">
              <div className="pm-col-inner">
                <Card title="产品图片" variant="outlined" className="pm-card">
                  <Form.Item name="images" noStyle>
                    <ProductImageList uploadUrl="/upload" />
                  </Form.Item>
                </Card>

                {/* 认证资质 */}
                <Card title="认证资质" variant="outlined" className="pm-card pm-card-stretch">
                  <Form.Item name="certificationIds" label="认证资质">
                    <Select mode="multiple" placeholder="选择现有证书" allowClear
                      optionFilterProp="label"
                      options={certificates.map((c) => ({
                        label: c.code ? `${c.name}（${c.code}）` : c.name,
                        value: c.id,
                      }))} />
                  </Form.Item>
                </Card>
              </div>
            </Col>

            {/* 右：基础信息栏（单列整行） */}
            <Col xs={24} xl={{ flex: '2 1 0%' }} className="pm-col-stretch">
              <Card title="基础信息" variant="outlined" className="pm-card">
                <div className="pm-back-step">
                  <Button type="link" size="small" icon={<ArrowLeftOutlined />} onClick={backToStep}>
                    返回选择 工艺 / 受众 / 品类
                  </Button>
                </div>

                {/* 工艺/受众/品类已移至第一步选择，此处保留隐藏 Form.Item 以维持字段注册，
                   使 SKU 预览的 useWatch 能随 setFieldsValue 实时更新 */}
                <Form.Item name="craftIds" hidden><Input /></Form.Item>
                <Form.Item name="audienceId" hidden><Input /></Form.Item>
                <Form.Item name="categoryId" hidden><Input /></Form.Item>

                <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
                  <Input placeholder="输入产品名称" />
                </Form.Item>

                <Form.Item name="supplyModes" label="供货模式">
                  <Select
                    mode="multiple"
                    placeholder={supplyModesReadOnly ? '深度定制（默认）' : '选择一个供货模式'}
                    allowClear={!supplyModesReadOnly}
                    disabled={supplyModesReadOnly}
                    maxCount={1}
                    options={SUPPLY_MODES.filter((s) => allowedSupplyModes.includes(s.value))}
                  />
                </Form.Item>

                {/* 尺寸：长宽高一行，置于商品描述上方 */}
                <div className="pm-size-row">
                  <div className="pm-size-row-title">尺寸 (cm)</div>
                  <Row gutter={10}>
                    <Col span={8}>
                      <Form.Item name="sizeL" label="长" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="sizeW" label="宽" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="sizeH" label="高" style={{ marginBottom: 0 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>

                {/* 克重 + 单位 一行，置于尺寸栏下方 */}
                <Row gutter={10} className="pm-size-row">
                  <Col span={12}>
                    <Form.Item name="weight" label="克重 (g)" style={{ marginBottom: 0 }}>
                      <Input placeholder="0" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="unit" label="单位" style={{ marginBottom: 0 }}>
                      <Select placeholder="选择" allowClear options={[{ label: '套', value: '套' }, { label: '个', value: '个' }]} />
                    </Form.Item>
                  </Col>
                </Row>

                <Divider className="pm-card-divider" />

                <Form.Item name="remark" label="商品描述">
                  <Input.TextArea rows={2} placeholder="备注信息" />
                </Form.Item>
              </Card>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 第一步：选择工艺 / 受众 / 品类 */}
      <Modal
        title="新建产品 · 选择分类"
        open={stepOpen}
        onCancel={() => setStepOpen(false)}
        onOk={handleStepNext}
        okText="下一步"
        cancelText="取消"
        width={680}
        destroyOnHidden
        forceRender={false}
      >
        <div className="pm-form" style={{ marginTop: 12 }}>
          {/* 工艺 */}
          <div className="pm-form-row">
            <label className="pm-form-label">
              工艺 <span className="pm-req">*</span>
            </label>
            <Row gutter={[10, 10]}>
              {crafts.map((c) => {
                const checked = stepCrafts.some((s) => s.id === c.id);
                return (
                  <Col span={8} key={c.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', checked && 'is-selected')}
                      title={checked && stepCrafts.length === 1 ? '至少保留一个工艺' : undefined}
                      onClick={() => {
                        // 最后一个选中的工艺不可取消
                        if (checked && stepCrafts.length === 1) return;
                        setStepCrafts((prev) =>
                          checked ? prev.filter((s) => s.id !== c.id) : [...prev, c],
                        );
                        setStepErr((e) => ({ ...e, craftId: undefined }));
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{c.name}</span>
                    </button>
                  </Col>
                );
              })}
            </Row>
            {stepErr.craftId && <div className="pm-pick-err">{stepErr.craftId}</div>}
          </div>

          {/* 受众：选完工艺后出现 */}
          {stepCrafts.length > 0 && (
            <div className="pm-form-row">
              <label className="pm-form-label">
                受众 <span className="pm-req">*</span>
              </label>
              <Row gutter={[10, 10]}>
                {audiences.map((a) => (
                  <Col span={8} key={a.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', stepAudience?.id === a.id && 'is-selected')}
                      onClick={() => {
                        setStepAudience(a);
                        setStepCategory(undefined);
                        setStepErr((e) => ({ ...e, audienceId: undefined, categoryId: undefined }));
                        // step-1 弹窗内仅同步本地 state，主表单 form 尚未挂载
                        setCategories(a?.categories || []);
                        setSelectedAudienceId(a.id);
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{a.name}</span>
                      {a.categories?.length ? (
                        <span className="pm-pick-sub">{a.categories.length} 个品类</span>
                      ) : null}
                    </button>
                  </Col>
                ))}
              </Row>
              {stepErr.audienceId && <div className="pm-pick-err">{stepErr.audienceId}</div>}
            </div>
          )}

          {/* 品类：选完受众后出现 */}
          {selectedAudienceId && (
            <div className="pm-form-row">
              <label className="pm-form-label">
                品类 <span className="pm-req">*</span>
              </label>
              <Row gutter={[10, 10]}>
                {categories.length ? categories.map((c) => (
                  <Col span={8} key={c.id}>
                    <button
                      type="button"
                      className={cx('pm-pick', stepCategory?.id === c.id && 'is-selected')}
                      onClick={() => {
                        setStepCategory(c);
                        setStepErr((e) => ({ ...e, categoryId: undefined }));
                      }}
                    >
                      <CheckCircleFilled className="pm-pick-check" />
                      <span className="pm-pick-name">{c.name}</span>
                    </button>
                  </Col>
                )) : (
                  <Col span={24}>
                    <div className="pm-pick-empty">该受众暂无品类，可直接进入下一步</div>
                  </Col>
                )}
              </Row>
              {stepErr.categoryId && <div className="pm-pick-err">{stepErr.categoryId}</div>}
            </div>
          )}
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title={`产品详情 - ${viewing?.name || ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={[
          <Button key="close" onClick={() => setDetailOpen(false)}>关闭</Button>,
          <Button key="edit" type="primary" icon={<EditOutlined />}
            onClick={() => { setDetailOpen(false); openEdit(viewing!); }}>编辑</Button>,
        ]}
        width={800}
        destroyOnHidden
      >
        {viewing && (
          <div className="pm-detail">
            <Row gutter={24}>
              <Col span={12}>
                <div className="pm-detail-section">
                  <h4>产品属性</h4>
                  {parseImages(viewing.images).length > 0 && (
                    <div className="pm-detail-images">
                      {parseImages(viewing.images).map((img, i) => (
                        <div key={i} className="pm-detail-img-item">
                          <img src={img.url} alt={img.name} />
                          <span>{img.name}{i === 0 ? '（主图）' : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p><Text type="secondary">尺寸：</Text>{[viewing.sizeL, viewing.sizeW, viewing.sizeH].filter(Boolean).join(' × ') || '-'}</p>
                  <p><Text type="secondary">克重：</Text>{viewing.weight || '-'} g</p>
                  <p><Text type="secondary">单位：</Text>{viewing.unit || '-'}</p>
                </div>
              </Col>
            </Row>
            <Divider />
            <Row gutter={16}>
              <Col span={8}><Text type="secondary">工艺：</Text>{viewing.crafts?.length ? viewing.crafts.map((c) => c.name).join(' + ') : '-'}</Col>
              <Col span={8}><Text type="secondary">受众：</Text>{viewing.audience?.name || '-'}</Col>
              <Col span={8}><Text type="secondary">品类：</Text>{viewing.category?.name || '-'}</Col>
            </Row>
            <p style={{ marginTop: 8 }}>
              <Text type="secondary">供货模式：</Text>
              {viewing.supplyModes
                ? viewing.supplyModes.split(',').map((m) => {
                    const f = SUPPLY_MODES.find((s) => s.value === m);
                    return f ? <Tag key={m}>{f.label}</Tag> : null;
                  })
                : '-'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
