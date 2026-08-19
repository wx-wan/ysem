import React, { useEffect, useState } from 'react';
import {
  Button, Space, Input, Modal, Form, Select,
  Switch, Tag, Popconfirm, message, Card, Row, Col, Typography, Divider, Pagination, Skeleton,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, ReloadOutlined, CheckCircleFilled,
} from '@ant-design/icons';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory,
  taxonomyApi,
} from '../api/products';
import ImageUploadCropper from '../components/common/ImageUploadCropper';
import ViewModeSwitch from '../components/common/ViewModeSwitch';
import ProductList from '../components/product/list/ProductList';

const { Text } = Typography;

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// 工艺固定展示顺序（前端兜底，确保 搪胶→注塑→硅胶 在前）


// 供货模式选项
export const SUPPLY_MODES = [
  { label: '深度定制', value: 'DEEP_CUSTOM' },
  { label: '轻定制', value: 'LIGHT_CUSTOM' },
  { label: '成品现货', value: 'STOCK' },
];

// 包装选项
const PACKAGING_OPTIONS = ['卡', '盒', '袋', '桶'];

// 功能勾选标签
const FEATURE_LABELS = { logo: 'Logo', sound: '发声', glow: '发光', colorChange: '变色', sprayWater: '喷水' };

export default function Products() {
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

  useEffect(() => { fetchTaxonomy(); }, []);
  useEffect(() => { fetchList(); }, [page, filterCraftId, filterAudienceId]);

  // 受众变化时联动品类
  const handleAudienceChange = (audienceId?: string) => {
    setSelectedAudienceId(audienceId);
    if (audienceId) {
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
    } else {
      setCategories([]);
    }
    try { form.setFieldValue('categoryId', undefined); } catch { /* 主表单未挂载时忽略 */ }
  };

  // 第一步卡片式选择的状态
  const [stepOpen, setStepOpen] = useState(false);
  const [stepCrafts, setStepCrafts] = useState<ProductCraft[]>([]);
  const [stepAudience, setStepAudience] = useState<ProductAudience | undefined>();
  const [stepCategory, setStepCategory] = useState<ProductCategory | undefined>();
  const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

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
    setTimeout(() => {
      form.resetFields();
      form.setFieldsValue({
        ...v,
        logo: false, sound: false, glow: false, colorChange: false, sprayWater: false,
      });
      if (v.audienceId) handleAudienceChange(v.audienceId);
    }, 0);
  };

  const openEdit = (record: Product) => {
    setEditing(record);
    setOpen(true);
    setTimeout(() => {
      form.setFieldsValue({
        ...record,
        craftIds: record.crafts?.map((c) => c.id) || [],
        supplyModes: record.supplyModes ? record.supplyModes.split(',') : [],
      });
      if (record.audienceId) handleAudienceChange(record.audienceId);
    }, 0);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const data = {
        ...values,
        supplyModes: Array.isArray(values.supplyModes) ? values.supplyModes.join(',') : '',
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
                placeholder="搜索产品名称 / SKU / 打样单号"
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
                      {r.images ? (
                        (() => {
                          const first = r.images.split(',').filter(Boolean)[0];
                          return first ? <img src={first} alt="" /> : null;
                        })()
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
        title={editing ? '编辑产品' : '新建产品'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        width={860}
        destroyOnHidden
        forceRender={false}
      >
        <Form form={form} layout="vertical" className="pm-form" style={{ marginTop: 16 }}>
          {/* 基础信息 */}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入' }]}>
                <Input placeholder="输入产品名称" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sku" label="SKU">
                <Input placeholder="可选，唯一编码" />
              </Form.Item>
            </Col>
          </Row>

          {/* 三级分类 */}
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="craftIds" label="工艺">
                <Select mode="multiple" placeholder="可多选，如 搪胶+注塑" allowClear
                  options={crafts.map((c) => ({ label: c.name, value: c.id }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="audienceId" label="受众">
                <Select placeholder="选择受众" allowClear onChange={handleAudienceChange}
                  options={audiences.map((a) => ({ label: a.name, value: a.id }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="categoryId" label="品类">
                <Select placeholder="先选受众" allowClear disabled={!selectedAudienceId}
                  options={categories.map((c) => ({ label: c.name, value: c.id }))} />
              </Form.Item>
            </Col>
          </Row>

          {/* ====== 双栏：属性区 + 要求区 ====== */}
          <Divider titlePlacement="left" plain>产品信息</Divider>
          <Row gutter={24}>
            {/* 左：(定制)产品属性 */}
            <Col span={12}>
              <Typography.Text strong className="pm-section-title">(定制)产品属性 <Text type="secondary">必填</Text></Typography.Text>
              <div className="pm-section-body">

                <div className="pm-form-row">
                  <label className="pm-form-row-label">造型图片（上传）</label>
                  <Form.Item name="images" noStyle>
                    <ImageUploadCropper aspect={NaN} maxSize={2 * 1024 * 1024} uploadUrl="/upload"
                      onUploaded={(url) => form.setFieldValue('images', url)} />
                  </Form.Item>
                </div>

                <Row gutter={10}>
                  <Col span={8}>
                    <Form.Item name="sizeL" label="长(cm)">
                      <Input placeholder="长" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="sizeW" label="宽(cm)">
                      <Input placeholder="宽" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="sizeH" label="高(cm)">
                      <Input placeholder="高" />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={10}>
                  <Col span={12}>
                    <Form.Item name="weight" label="克重(g)">
                      <Input placeholder="克重" />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="unit" label="产品单位">
                      <Select placeholder="单位" allowClear options={[{ label: '套', value: '套' }, { label: '个', value: '个' }]} />
                    </Form.Item>
                  </Col>
                </Row>

              </div>
            </Col>

            {/* 右：(深/轻)产品要求 */}
            <Col span={12}>
              <Typography.Text strong className="pm-section-title">(深/轻) 产品要求 <Text type="secondary">（打样单号）</Text></Typography.Text>
              <div className="pm-section-body">

                <Form.Item name="sampleNo" label="打样单号">
                  <Input placeholder="输入打样单号" />
                </Form.Item>

                <div className="pm-form-row">
                  <label className="pm-form-row-label">功能（勾选）</label>
                  <Row gutter={[8, 8]}>
                    {(['logo', 'sound', 'glow', 'colorChange', 'sprayWater'] as const).map((key) => (
                      <Col span={8} key={key}>
                        <Form.Item name={key} valuePropName="checked" noStyle>
                          <Switch checkedChildren={FEATURE_LABELS[key]} unCheckedChildren={FEATURE_LABELS[key]} />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                </div>

                <Form.Item name="colors" label="颜色（潘通色）">
                  <Input placeholder="多个颜色逗号分隔" />
                </Form.Item>

                <div className="pm-form-row">
                  <label className="pm-form-row-label">颜色标注图</label>
                  <Form.Item name="colorImage" noStyle>
                    <ImageUploadCropper aspect={NaN} uploadUrl="/upload"
                      onUploaded={(url) => form.setFieldValue('colorImage', url)} />
                  </Form.Item>
                </div>

                <Form.Item name="packaging" label="产品包装">
                  <Select mode="multiple" placeholder="选择包装类型" allowClear
                    options={PACKAGING_OPTIONS.map((p) => ({ label: p, value: p }))} />
                </Form.Item>

              </div>
            </Col>
          </Row>

          {/* 供货定制模式 */}
          <Divider titlePlacement="left" plain>供货定制模式 <Text type="secondary">（多选属性）由用户角色决定</Text></Divider>
          <Form.Item name="supplyModes" label="供货模式">
            <Select mode="multiple" placeholder="选择供货模式" allowClear
              options={SUPPLY_MODES} />
          </Form.Item>

          {/* 备注 */}
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" />
          </Form.Item>
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
          {/* 三步指示器 */}
          <div className="pm-step-bar">
            <div className={cx('pm-step-dot', stepCrafts.length && 'is-done')}>
              <span className="pm-step-idx">1</span>
              <span className="pm-step-label">{stepCrafts.length ? crafts.filter((c) => stepCrafts.some((s) => s.id === c.id)).map((c) => c.name).join('+') : '工艺'}</span>
            </div>
            <div className="pm-step-line" />
            <div className={cx('pm-step-dot', stepCrafts.length && 'is-active', stepAudience && 'is-done')}>
              <span className="pm-step-idx">2</span>
              <span className="pm-step-label">{stepAudience ? stepAudience.name : '受众'}</span>
            </div>
            <div className="pm-step-line" />
            <div className={cx('pm-step-dot', stepAudience && 'is-active', stepCategory && 'is-done')}>
              <span className="pm-step-idx">3</span>
              <span className="pm-step-label">{stepCategory ? stepCategory.name : '品类'}</span>
            </div>
          </div>

          {/* 工艺 */}
          <div className="pm-form-row">
            <label className="pm-form-row-label">
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
              <label className="pm-form-row-label">
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
                        handleAudienceChange(a.id);
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
              <label className="pm-form-row-label">
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
                  <h4>(定制)产品属性</h4>
                  {viewing.images && (
                    <div className="pm-detail-images">
                      {viewing.images.split(',').filter(Boolean).map((img, i) => (
                        <img key={i} src={img} alt="" style={{ maxWidth: 200, borderRadius: 8, marginBottom: 8 }} />
                      ))}
                    </div>
                  )}
                  <p><Text type="secondary">尺寸：</Text>{[viewing.sizeL, viewing.sizeW, viewing.sizeH].filter(Boolean).join(' × ') || '-'}</p>
                  <p><Text type="secondary">克重：</Text>{viewing.weight || '-'} g</p>
                  <p><Text type="secondary">单位：</Text>{viewing.unit || '-'}</p>
                </div>
              </Col>
              <Col span={12}>
                <div className="pm-detail-section">
                  <h4>(深/轻) 产品要求</h4>
                  <p><Text type="secondary">打样单号：</Text>{viewing.sampleNo || '-'}</p>
                  <div style={{ marginBottom: 8 }}>
                    {(['logo', 'sound', 'glow', 'colorChange', 'sprayWater'] as const).map((k) =>
                      viewing[k] ? <Tag key={k} color="blue">{FEATURE_LABELS[k]}</Tag> : null
                    )}
                  </div>
                  <p><Text type="secondary">颜色：</Text>{viewing.colors || '-'}</p>
                  {viewing.colorImage && <img src={viewing.colorImage} alt="" style={{ maxWidth: 150, borderRadius: 8 }} />}
                  <p><Text type="secondary">包装：</Text>{viewing.packaging || '-'}</p>
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
