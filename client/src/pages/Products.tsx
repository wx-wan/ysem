import React, { useEffect, useState } from 'react';
import {
  Button, Space, Input, Modal, Form, Select,
  Switch, Tag, Popconfirm, message, Card, Row, Col, Typography, Divider, Pagination,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory,
  taxonomyApi,
} from '../api/products';
import ImageUploadCropper from '../components/common/ImageUploadCropper';

const { Text } = Typography;

// 供货模式选项
const SUPPLY_MODES = [
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

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await productApi.getList({
        page, pageSize, keyword,
        craftId: filterCraftId,
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
    form.setFieldValue('categoryId', undefined);
    if (audienceId) {
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
    } else {
      setCategories([]);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ logo: false, sound: false, glow: false, colorChange: false, sprayWater: false });
    setOpen(true);
  };

  const openEdit = (record: Product) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      supplyModes: record.supplyModes ? record.supplyModes.split(',') : [],
    });
    if (record.audienceId) handleAudienceChange(record.audienceId);
    setOpen(true);
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
      {/* 页面头 */}
      <div className="pm-header">
        <div>
          <h2 className="pm-title">产品管理</h2>
          <p className="pm-desc">定制类产品开发与管理</p>
        </div>
      </div>

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
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建产品</Button>
          </Col>
        </Row>
      </Card>

      {/* 数据卡片网格 */}
      <Card className="pm-grid-card" styles={{ body: { padding: 20 } }}>
        {loading ? (
          <div className="pm-grid-loading">加载中…</div>
        ) : list.length === 0 ? (
          <div className="pm-grid-empty">暂无产品，点击右上角「新建产品」开始添加</div>
        ) : (
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
                        {r.craft ? <span className="pm-prod-tag">{r.craft.name}</span> : null}
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
              <Form.Item name="craftId" label="一级工艺">
                <Select placeholder="选择工艺" allowClear options={crafts.map((c) => ({ label: c.name, value: c.id }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="audienceId" label="二级受众">
                <Select placeholder="选择受众" allowClear onChange={handleAudienceChange}
                  options={audiences.map((a) => ({ label: a.name, value: a.id }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="categoryId" label="三级品类">
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

                <Form.Item name="images" label="造型图片（上传）">
                  <ImageUploadCropper aspect={NaN} maxSize={2 * 1024 * 1024} uploadUrl="/upload"
                    onUploaded={(url) => form.setFieldValue('images', url)} />
                </Form.Item>

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

                <Form.Item label="功能（勾选）">
                  <Row gutter={[8, 8]}>
                    {(['logo', 'sound', 'glow', 'colorChange', 'sprayWater'] as const).map((key) => (
                      <Col span={8} key={key}>
                        <Form.Item name={key} valuePropName="checked" noStyle>
                          <Switch checkedChildren={FEATURE_LABELS[key]} unCheckedChildren={FEATURE_LABELS[key]} />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                </Form.Item>

                <Form.Item name="colors" label="颜色（潘通色）">
                  <Input placeholder="多个颜色逗号分隔" />
                </Form.Item>

                <Form.Item name="colorImage" label="颜色标注图">
                  <ImageUploadCropper aspect={NaN} uploadUrl="/upload"
                    onUploaded={(url) => form.setFieldValue('colorImage', url)} />
                </Form.Item>

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
              <Col span={8}><Text type="secondary">工艺：</Text>{viewing.craft?.name || '-'}</Col>
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
