import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Space, Input, Modal, Form, Select, Radio,
  Tag, Popconfirm, App, Card, Row, Col, Typography, Divider, Pagination, Skeleton, Flex,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, CheckCircleFilled, ArrowLeftOutlined,
  CloseOutlined, ClockCircleOutlined, ShoppingOutlined,
  FileTextOutlined, TagsOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory, ProductActivity,
  taxonomyApi,
} from '../api/products';
import { certificateApi, Certificate } from '../api/certificates';
import { userApi } from '../api/users';
import { salesApi, SalesItem, STAGE_META } from '../api/sales';
import ProductImageList from '../components/common/ProductImageList';
import { getProgressPhase, STATUS_TAG_COLOR } from '../components/common/ProductProgress';
import { buildTablePagination } from '../components/common/tablePagination';
import { StepBar } from '../components/common/StepBar';
import { useCardGutter } from '../components/common/tokens';
import { parseImages, mainImageUrl } from '../utils/productImages';
import ViewModeSwitch from '../components/common/ViewModeSwitch';
import ProductList from '../components/product/list/ProductList';
import ProductCard, { ProductCardSkeleton } from '../components/product/cards/ProductCard';
import SegmentedTabBar from '../components/common/SegmentedTabBar';
import { useAuthStore } from '../stores/useAuthStore';

const { Text } = Typography;

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

// 供货模式选项（共享配置）
import { SUPPLY_MODES } from '../config/product';

// 供货模式按角色可选范围：admin 全选 / purchaser 含深度定制+轻定制+现货 / 其他（业务等）默认深度定制、不可修改
const SUPPLY_MODES_BY_ROLE: Record<string, string[]> = {
  admin: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'],
  purchaser: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'STOCK'],
};
const DEFAULT_SUPPLY_MODE = 'DEEP_CUSTOM';

export default function Products() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const cardGutter = useCardGutter();
  const [list, setList] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(6);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [filterCraftId, setFilterCraftId] = useState<string | undefined>();
  const [filterAudienceId, setFilterAudienceId] = useState<string | undefined>();
  const [filterVisibility, setFilterVisibility] = useState<string | undefined>();

  // 用户列表（用于「不公开」产品指定可见人）
  const [users, setUsers] = useState<{ id: string; username: string; realName?: string }[]>([]);

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
  const [detailTab, setDetailTab] = useState<'overview' | 'sales' | 'activity'>('overview');
  const [salesList, setSalesList] = useState<SalesItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [form] = Form.useForm();
  const visValue = Form.useWatch('visibility', form) as 'PUBLIC' | 'PRIVATE' | undefined;
  const visibleUserIds = Form.useWatch('visibleUserIds', form) as string[] | undefined;
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  // 当前用户角色 → 供货模式可选范围（admin 全选 / purchaser 轻定制+现货 / 其他默认深度定制）
  const roleCode = useAuthStore((s) => s.user?.role?.code ?? '');
  const canDelete = roleCode === 'admin' || roleCode === 'ADMIN';
  const allowedSupplyModes = SUPPLY_MODES_BY_ROLE[roleCode] ?? [DEFAULT_SUPPLY_MODE];
  const supplyModesReadOnly = allowedSupplyModes.length <= 1; // 仅一个可用项（业务等）→ 不可修改

  // 打开产品详情：重置 Tab 并加载销售记录
  const openDetail = (r: Product) => {
    setViewing(r);
    setDetailTab('overview');
    setDetailOpen(true);
    setSalesLoading(true);
    salesApi.listByProduct(r.id)
      .then((res) => {
        if (res.data?.data?.list) setSalesList(res.data.data.list);
        else setSalesList([]);
      })
      .catch(() => setSalesList([]))
      .finally(() => setSalesLoading(false));
  };

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await productApi.getList({
        page, pageSize, keyword,
        craftIds: filterCraftId,
        audienceId: filterAudienceId,
        visibility: filterVisibility,
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
  useEffect(() => { fetchList(); }, [page, filterCraftId, filterAudienceId, filterVisibility]);

  // 受众变化时联动品类
  const handleAudienceChange = (audienceId?: string) => {
    setSelectedAudienceId(audienceId);
    if (audienceId) {
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
      // 回填/联动时：仅当当前品类不属于新受众的品类列表时才清空（aud 未加载时保留现值）
      try {
        const cur = form.getFieldValue('categoryId');
        if (cur && aud && !aud.categories?.some((c) => c.id === cur)) form.setFieldValue('categoryId', undefined);
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
  // 从编辑弹窗「返回选择」时，暂存未提交的表单值与编辑态，重选后恢复
  const draftRef = useRef<{ values: Record<string, unknown>; editing: Product | null } | null>(null);
  const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

  const watchedCraftIds = Form.useWatch('craftIds', form);
  const watchedAudienceId = Form.useWatch('audienceId', form);
  const watchedCategoryId = Form.useWatch('categoryId', form);

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
    const draft = draftRef.current;
    if (draft?.editing) {
      // 从编辑弹窗「返回重选」后回到编辑：保留未提交值与编辑态，仅用重选的工艺/品类覆盖
      setOpen(true);
      form.resetFields();
      const resumeSupply = Array.isArray(draft.values.supplyModes) && (draft.values.supplyModes as string[]).length
        ? (draft.values.supplyModes as string[])[0]
        : allowedSupplyModes[0];
      form.setFieldsValue({
        ...draft.values,
        ...v,
        supplyModes: resumeSupply,
      });
    } else {
      // 新建流程：正常初始化
      setEditing(null);
      setOpen(true);
      // 主表单 Modal 已 forceRender，form 常驻连接，可直接初始化
      form.resetFields();
      form.setFieldsValue({
        ...v,
        // 新建默认：管理员/采购取首个可用模式，业务默认深度定制
        supplyModes: allowedSupplyModes[0],
      });
    }
    draftRef.current = null;
    if (v.audienceId) handleAudienceChange(v.audienceId);
  };

  // 懒加载「指定可见人」候选用户：仅在编辑弹窗打开时按需拉取。
  // 用轻量接口 /users/select（对所有登录用户开放，无需 system:user 权限），
  // 业务员等角色也能正常获取候选列表，不会触发「权限不足」提示。
  const loadUsers = useCallback(async () => {
    try {
      const r = await userApi.listForSelect();
      if (r.data.code === 200 || r.data.code === 0) {
        setUsers(r.data.data.map((u) => ({
          id: u.id,
          username: u.username,
          realName: u.realName ?? undefined,
        })));
      }
    } catch {
      /* 失败保持 users 为空，「指定可见人」不可用即可 */
    }
  }, []);

  const openEdit = (record: Product) => {
    setEditing(record);
    setOpen(true);
    loadUsers();
    // 主表单 Modal 已 forceRender，先重置再回填，避免残留上一次的值
    form.resetFields();
    // 供货模式按角色过滤（如采购不可含深度定制；业务固定深度定制）
    const modes = (record.supplyModes ? record.supplyModes.split(',') : [])
      .filter((m) => allowedSupplyModes.includes(m));
    form.setFieldsValue({
      ...record,
      craftIds: record.crafts?.map((c) => c.id) || [],
      supplyModes: modes.length ? modes[0] : allowedSupplyModes[0],
      certificationIds: record.certificationIds ? record.certificationIds.split(',') : [],
      visibility: record.visibility || 'PUBLIC',
      visibleUserIds: record.visibleUsers?.map((v) => v.userId) ?? [],
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
    // 暂存当前编辑弹窗里未提交的值与编辑态，重选后恢复
    draftRef.current = { values: form.getFieldsValue(true), editing };
    setOpen(false);
    setStepOpen(true);
  };

  // 将表单中未填产生的 null 转为 undefined，避免后端 Zod 对 z.string().optional() 报 "Expected string, received null"
  const cleanNullValues = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, value]) => {
      out[key] = value === null ? undefined : value;
    });
    return out;
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      // 工艺/受众/品类已移至第一步选择，未渲染 Form.Item，需从 store 显式取出并入提交数据
      const extra = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
      const data = {
        ...cleanNullValues(extra),
        ...cleanNullValues(values),
        // 供货模式由后续逻辑决定，前端不再选择：
        // 编辑时保留该产品原有模式（若当前角色允许），新建时取当前角色默认模式
        supplyModes: editing?.supplyModes && allowedSupplyModes.includes(editing.supplyModes)
          ? editing.supplyModes
          : allowedSupplyModes[0],
        certificationIds: Array.isArray(values.certificationIds) ? values.certificationIds.join(',') : '',
        // 公开产品不指定可见人：显式置空，确保后端清空已存在的可见人关联
        visibleUserIds: values.visibility === 'PUBLIC' ? [] : (values.visibleUserIds ?? []),
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
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown[]; response?: { data?: { message?: string } }; message?: string };
      if (e && Array.isArray(e.errorFields)) {
        message.error('请检查表单必填项');
      } else {
        const msg = e?.response?.data?.message || e?.message || '保存失败';
        message.error(msg);
      }
    }
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
              <Select
                placeholder={t('product.visibility')}
                value={filterVisibility}
                onChange={(v) => { setFilterVisibility(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={[
                  { label: t('product.visibilityPublic'), value: 'PUBLIC' },
                  { label: t('product.visibilityPrivate'), value: 'PRIVATE' },
                ]}
              />
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchList}>搜索</Button>
              <Button icon={<ReloadOutlined />} onClick={() => { setKeyword(''); setFilterCraftId(undefined); setFilterAudienceId(undefined); setFilterVisibility(undefined); setPage(1); }}>重置</Button>
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
                <ProductCardSkeleton />
              </Col>
            ))}
          </Row>
        ) : list.length === 0 ? (
          <div className="pm-grid-empty">暂无产品，点击右上角「新建产品」开始添加</div>
        ) : viewMode === 'card' ? (
          <>
            <Row gutter={[16, 16]}>
              {list.map((r) => (
                <Col key={r.id} xs={24} sm={12} md={12} lg={8} xl={8}>
                  <ProductCard
                    product={r}
                    onOpenDetail={openDetail}
                    onDelete={handleDelete}
                    canDelete={canDelete}
                  />
                </Col>
              ))}
            </Row>
            <div className="pm-grid-pager">
              <Pagination
                {...buildTablePagination({
                  total,
                  page,
                  pageSize,
                  onChange: (p) => setPage(p),
                })}
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
            onView={(r) => openDetail(r)}
            onEdit={openEdit}
            onDelete={handleDelete}
            canDelete={canDelete}
          />
        )}
      </Card>

      {/* 新建 / 编辑弹窗 */}
      <Modal
        title={
          <div className="pm-modal-title">
            <span className="pm-modal-title-main">{editing ? '编辑产品' : '新建产品'}</span>
            <span className="pm-sku-head">
              {(() => {
                const { phase, label } = getProgressPhase(editing?.progress ?? null);
                return <Tag color={STATUS_TAG_COLOR[phase]} className="pm-sku-status">{label}</Tag>;
              })()}
              <span className="pm-sku-preview">{editing?.id || '新建后生成'}</span>
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
            <div className="pm-modal-actions">
              <div className="pm-vis-switch" role="group" aria-label={t('product.visibility')}>
                <button
                  type="button"
                  className={cx('pm-vis-opt', visValue === 'PUBLIC' && 'is-active')}
                  onClick={() => form.setFieldsValue({ visibility: 'PUBLIC' })}
                >
                  {t('product.visibilityPublic')}
                </button>
                <button
                  type="button"
                  className={cx('pm-vis-opt', visValue === 'PRIVATE' && 'is-active')}
                  onClick={() => form.setFieldsValue({ visibility: 'PRIVATE' })}
                >
                  {t('product.visibilityPrivate')}
                </button>
              </div>
              {visValue === 'PRIVATE' ? (
                <Select
                  mode="multiple"
                  size="small"
                  maxTagCount="responsive"
                  allowClear
                  placeholder={t('product.visibleUsersPlaceholder')}
                  optionFilterProp="label"
                  className="pm-vis-users"
                  value={visibleUserIds ?? []}
                  onChange={(next) => form.setFieldsValue({ visibleUserIds: next })}
                  options={users.map((u) => ({
                    label: u.realName || u.username,
                    value: u.id,
                  }))}
                />
              ) : null}
            </div>
            <button
              type="button"
              className="pm-modal-close"
              aria-label="关闭"
              onClick={() => setOpen(false)}
            >
              <CloseOutlined />
            </button>
          </div>
        }
        closeIcon={null}
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
          header: { paddingRight: 0 },
        }}
      >
        <Form form={form} layout="vertical" className="pm-form">
          <Row gutter={cardGutter}>
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

                {/* 工艺/受众/品类已移至第一步选择，此处保留隐藏 Form.Item 以维持字段注册 */}
                <Form.Item name="craftIds" hidden><Input /></Form.Item>
                <Form.Item name="audienceId" hidden><Input /></Form.Item>
                <Form.Item name="categoryId" hidden><Input /></Form.Item>

                {/* 公开/不公开切换与「指定可见人」已上移至弹窗右上角操作区（pm-modal-actions） */}
                <Form.Item name="visibility" hidden initialValue="PUBLIC"><Input /></Form.Item>
                <Form.Item
                  name="visibleUserIds"
                  hidden
                >
                  <Select mode="multiple" />
                </Form.Item>

                <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
                  <Input placeholder="输入产品名称" />
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
                  <Input.TextArea rows={3} placeholder="详细介绍商品特色、材质、核心功能卖点..." />
                </Form.Item>
              </Card>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* 第一步：选择工艺 / 受众 / 品类 */}
      <Modal
        title={draftRef.current?.editing ? '重选分类' : '新建产品 · 选择分类'}
        open={stepOpen}
        onCancel={() => setStepOpen(false)}
        onOk={handleStepNext}
        okText="下一步"
        cancelText="取消"
        width={680}
        destroyOnHidden
        forceRender={false}
      >
        <div className="pm-step-flow">
          <StepBar
            embedded
            current={!stepCrafts.length ? 0 : !stepAudience ? 1 : stepCategory?.id ? 3 : 2}
            items={[
              { title: '选择工艺', statusText: !stepCrafts.length ? '进行中' : '已完成' },
              { title: '选择受众', statusText: stepCrafts.length && !stepAudience ? '进行中' : stepAudience ? '已完成' : '待处理' },
              { title: '选择品类', statusText: stepAudience ? (stepCategory?.id ? '已完成' : '进行中') : '待处理' },
            ]}
          />
          <div className="pm-step-flow__body">
            <Form component={false} layout="vertical">
            {/* 工艺 */}
          {/* 工艺 */}
          <Form.Item
            label="工艺"
            required
            validateStatus={stepErr.craftId ? 'error' : ''}
            help={stepErr.craftId}
          >
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
          </Form.Item>

          {/* 受众：选完工艺后出现 */}
          {stepCrafts.length > 0 && (
            <Form.Item
              label="受众"
              required
              validateStatus={stepErr.audienceId ? 'error' : ''}
              help={stepErr.audienceId}
            >
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
            </Form.Item>
          )}

          {/* 品类：选完受众后出现 */}
          {selectedAudienceId && (
            <>
              {/* 供货模式：由后续逻辑决定，前端只读展示在品类左侧上方 */}
              <div className="pm-supply-readonly">
                <span className="pm-supply-readonly__label">供货模式</span>
                <span className="pm-supply-readonly__value">
                  {SUPPLY_MODES.find((s) => s.value === allowedSupplyModes[0])?.label || allowedSupplyModes[0]}
                </span>
              </div>
              <Form.Item
                label="品类"
                required
                validateStatus={stepErr.categoryId ? 'error' : ''}
                help={stepErr.categoryId}
              >
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
            </Form.Item>
            </>
          )}
            </Form>
          </div>
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={920}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        {viewing && (
          <div className="pm-detail">
            {/* 左侧：彩色信息栏 */}
            <div className="pm-detail-aside">
              {mainImageUrl(viewing.images) ? (
                <img
                  className="pm-detail-aside__avatar"
                  src={mainImageUrl(viewing.images)}
                  alt={viewing.name}
                />
              ) : (
                <div className="pm-detail-aside__avatar-fallback">
                  {(viewing.name || '·').slice(0, 1).toUpperCase()}
                </div>
              )}
              <h3 className="pm-detail-aside__name">{viewing.name}</h3>
              <Text className="pm-detail-aside__sku">SKU: {viewing.sku || '\u2014'}</Text>

              <div className="pm-detail-aside__tags">
                {viewing.crafts?.length ? viewing.crafts.map((c) => (
                  <Tag key={c.id} className="pm-detail-aside__tag">{c.name}</Tag>
                )) : <span className="pm-detail-aside__muted">无工艺</span>}
              </div>

              <div className="pm-detail-aside__rows">
                <div className="pm-detail-aside__row">
                  <span className="pm-detail-aside__label">受众</span>
                  <span>{viewing.audience?.name || '\u2014'}</span>
                </div>
                <div className="pm-detail-aside__row">
                  <span className="pm-detail-aside__label">品类</span>
                  <span>{viewing.category?.name || '\u2014'}</span>
                </div>
                <div className="pm-detail-aside__row">
                  <span className="pm-detail-aside__label">供货模式</span>
                  <span>
                    {viewing.supplyModes
                      ? viewing.supplyModes.split(',').map((m) => {
                          const f = SUPPLY_MODES.find((s) => s.value === m);
                          return f ? <span key={m} className="pm-detail-aside__chip">{f.label}</span> : null;
                        })
                      : '\u2014'}
                  </span>
                </div>
                <div className="pm-detail-aside__row">
                  <span className="pm-detail-aside__label">可见性</span>
                  <span>{viewing.visibility === 'PRIVATE' ? '私密' : '公开'}</span>
                </div>
              </div>

              <div className="pm-detail-aside__actions">
                <Button type="primary" icon={<EditOutlined />} block
                  onClick={() => { setDetailOpen(false); openEdit(viewing); }}>编辑资料</Button>
                <Button icon={<CloseOutlined />} block style={{ marginTop: 8 }}
                  onClick={() => setDetailOpen(false)}>关闭</Button>
              </div>
            </div>

            {/* 右侧：Tab 内容区 */}
            <div className="pm-detail-main">
              <SegmentedTabBar
                value={detailTab}
                onChange={(k) => setDetailTab(k as 'overview' | 'sales' | 'activity')}
                options={[
                  { key: 'overview', label: '概览' },
                  { key: 'sales', label: '销售记录', count: salesList.length },
                  { key: 'activity', label: '操作记录', count: viewing.activities?.length || 0 },
                ]}
              />
              <div className="pm-detail-content">
                {detailTab === 'overview' && (
                  <div className="pm-detail-section">
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

                    <div className="pm-detail-group">
                      <h4 className="pm-detail-h4"><TagsOutlined /> 产品属性</h4>
                      <div className="pm-detail-props">
                        <div><span className="pm-detail-props__label">尺寸</span><b>{[viewing.sizeL, viewing.sizeW, viewing.sizeH].filter(Boolean).join(' × ') || '\u2014'}</b></div>
                        <div><span className="pm-detail-props__label">克重</span><b>{viewing.weight || '\u2014'} g</b></div>
                        <div><span className="pm-detail-props__label">单位</span><b>{viewing.unit || '\u2014'}</b></div>
                      </div>
                    </div>

                    <div className="pm-detail-group">
                      <h4 className="pm-detail-h4"><FileTextOutlined /> 产品要求</h4>
                      <div className="pm-detail-props">
                        <div><span className="pm-detail-props__label">LOGO 定制</span><b>{viewing.hasLogo ? '是' : '否'}</b></div>
                        <div><span className="pm-detail-props__label">发声</span><b>{viewing.hasSound ? '是' : '否'}</b></div>
                        <div><span className="pm-detail-props__label">发光</span><b>{viewing.hasLight ? '是' : '否'}</b></div>
                        <div><span className="pm-detail-props__label">变色</span><b>{viewing.hasColorChange ? '是' : '否'}</b></div>
                        <div><span className="pm-detail-props__label">喷水</span><b>{viewing.hasWater ? '是' : '否'}</b></div>
                        <div><span className="pm-detail-props__label">潘通色号</span><b>{viewing.pantoneNo || '\u2014'}</b></div>
                        <div><span className="pm-detail-props__label">包装方式</span><b>{viewing.packageType || '\u2014'}</b></div>
                        <div><span className="pm-detail-props__label">打样单号</span><b>{viewing.sampleNo || '\u2014'}</b></div>
                      </div>
                    </div>

                    {(viewing.remark || viewing.desc) && (
                      <div className="pm-detail-group">
                        <h4 className="pm-detail-h4">备注 / 描述</h4>
                        <p className="pm-detail-remark">{viewing.remark || viewing.desc || '无'}</p>
                      </div>
                    )}
                  </div>
                )}

                {detailTab === 'sales' && (
                  <div className="pm-detail-section">
                    {salesLoading ? (
                      <div className="pm-detail-empty">加载中…</div>
                    ) : salesList.length === 0 ? (
                      <div className="pm-detail-empty">暂无销售记录</div>
                    ) : (
                      <ul className="pm-sales-list">
                        {salesList.map((s) => (
                          <li key={s.id} className="pm-sales-item">
                            <div className="pm-sales-item__head">
                              <span className="pm-sales-item__company">{s.companyName || s.title}</span>
                              <Tag color={STAGE_META[s.stage]?.color || 'default'}>
                                {STAGE_META[s.stage]?.label || s.stage}
                              </Tag>
                            </div>
                            <div className="pm-sales-item__meta">
                              <span>商机号：<b>{s.pipelineNumber}</b></span>
                              <span>数量：<b>{(s as any).quantity ?? '\u2014'}</b></span>
                              <span>负责人：<b>{s.assignee?.realName || s.assignee?.username || '\u2014'}</b></span>
                              <span>更新：<b>{s.updateTime ? dayjs(s.updateTime).format('YYYY-MM-DD') : '\u2014'}</b></span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {detailTab === 'activity' && (
                  <div className="pm-detail-section">
                    <div className="pm-activity">
                      <div className="pm-activity__title">
                        <ClockCircleOutlined /> 操作记录
                      </div>
                      {(!viewing.activities || viewing.activities.length === 0) && (
                        <p className="pm-activity__empty">暂无操作记录</p>
                      )}
                      <ul className="pm-activity__list">
                        {(viewing.activities || []).map((act: ProductActivity) => (
                          <li key={act.id} className="pm-activity__item">
                            <span className={`pm-activity__badge pm-activity__badge--${act.action.toLowerCase()}`}>
                              {act.action === 'CREATE' ? '创建' : act.action === 'UPDATE' ? '更新' : act.action === 'DELETE' ? '删除' : act.action}
                            </span>
                            <span className="pm-activity__meta">
                              {act.operator ? `${act.operator} · ` : ''}
                              {act.createdAt ? dayjs(act.createdAt).format('YYYY-MM-DD HH:mm') : ''}
                            </span>
                            {act.detail && (
                              <span className="pm-activity__detail">{act.detail}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
