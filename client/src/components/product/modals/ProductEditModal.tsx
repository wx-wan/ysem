/**
 * 产品新建 / 编辑弹窗（含第一步「选择分类」流程）
 * 从 Products.tsx 解构出来，对外暴露命令式 API：
 *   ref.current.open(record?)  // record 缺省为新建
 */
import React, { useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { App, Button, Space, Input, Modal, Form, Select, Segmented, Tag, Tooltip, Table, Row, Col } from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, CheckCircleFilled, ArrowLeftOutlined,
  CloseOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../../stores/useAuthStore';
import productApi, { Product, ProductCraft, ProductAudience, ProductCategory, productGroupApi } from '../../../api/products';
import { userApi } from '../../../api/users';
import { certificateApi, Certificate } from '../../../api/certificates';
import { getProgressPhase, STATUS_TAG_COLOR } from '../../../components/common/ProductProgress';
import { StepBar } from '../../../components/common/StepBar';
import ProductImageList from '../../common/ProductImageList';

const SUPPLY_MODES_BY_ROLE: Record<string, string[]> = {
  admin: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'READY_STOCK'],
  ADMIN: ['DEEP_CUSTOM', 'LIGHT_CUSTOM', 'READY_STOCK'],
  purchaser: ['LIGHT_CUSTOM', 'READY_STOCK'],
};
const DEFAULT_SUPPLY_MODE = 'DEEP_CUSTOM';

export interface ProductEditModalHandle {
  open: (record?: Product | null) => void;
}

interface Props {
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  onSuccess: () => void;
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const cleanNullValues = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([key, value]) => {
    out[key] = value === null ? undefined : value;
  });
  return out;
};

export const ProductEditModal = React.forwardRef<ProductEditModalHandle, Props>(
  ({ crafts, audiences, onSuccess }, ref) => {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { user: currentUser } = useAuthStore();
    const roleCode = currentUser?.role?.code ?? '';
    const allowedSupplyModes = SUPPLY_MODES_BY_ROLE[roleCode] ?? [DEFAULT_SUPPLY_MODE];

    const [form] = Form.useForm();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);
    // 组合明细（行内录入）：关联已有单品(productId) 或 快速新建单品(name)
    const [groupItems, setGroupItems] = useState<
      {
        key: string; productId?: string; name?: string;
        images?: string; sizeL?: string; sizeW?: string; sizeH?: string; weight?: string;
        certificationIds?: string; remark?: string;
      }[]
    >([]);

    const [stepOpen, setStepOpen] = useState(false);
    const [stepCrafts, setStepCrafts] = useState<ProductCraft[]>([]);
    const [stepAudience, setStepAudience] = useState<ProductAudience | undefined>();
    const [stepCategory, setStepCategory] = useState<ProductCategory | undefined>();
    const draftRef = useRef<{ values: Record<string, unknown>; editing: Product | null } | null>(null);
    const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();

    const [skuPreview, setSkuPreview] = useState<string>('');
    const [users, setUsers] = useState<{ id: string; username: string; realName?: string }[]>([]);
    const [singleProducts, setSingleProducts] = useState<{ id: string; name: string; sku: string }[]>([]);
    const [certificates, setCertificates] = useState<Certificate[]>([]);

    // 受众变化时联动品类
    const handleAudienceChange = (audienceId?: string) => {
      setSelectedAudienceId(audienceId);
      if (audienceId) {
        const aud = audiences.find((a) => a.id === audienceId);
        setCategories(aud?.categories || []);
        try {
          const cur = form.getFieldValue('categoryId');
          if (cur && aud && !aud.categories?.some((c) => c.id === cur)) form.setFieldValue('categoryId', undefined);
        } catch { /* 主表单未挂载时忽略 */ }
      } else {
        setCategories([]);
        try { form.setFieldValue('categoryId', undefined); } catch { /* 主表单未挂载时忽略 */ }
      }
    };

    const watchedCraftIds = Form.useWatch('craftIds', form);
    const watchedAudienceId = Form.useWatch('audienceId', form);
    const watchedCategoryId = Form.useWatch('categoryId', form);
    const visValue = Form.useWatch('visibility', form) as 'PUBLIC' | 'PRIVATE' | undefined;

    // 单品/组合：已移除 unit 字段，统一用「是否有组合明细卡片」判断（编辑时 groupItems 由 items 回填）
    const isGroupMode = groupItems.length > 0;
    const productTypeWatch = (isGroupMode ? 'GROUP' : 'PRODUCT') as 'PRODUCT' | 'GROUP' | undefined;

    useImperativeHandle(ref, () => ({
      open: (record?: Product | null) => {
        if (record) openEdit(record);
        else openCreate();
      },
    }));

    // 证书列表（挂载时加载一次，供「相关证书」选择）
    useEffect(() => {
      certificateApi.list().then((res) => {
        if (res.data.code === 200 || res.data.code === 0) setCertificates(res.data.data);
      }).catch(() => {});
    }, []);

    // SKU 自动预览
    useEffect(() => {
      const craftsKey = (watchedCraftIds ?? []).map(String).sort().join(',');
      const audId = watchedAudienceId as string | undefined;
      if (!craftsKey || !audId) { setSkuPreview(''); return; }
      if (editing) {
        const origCraftsKey = (editing.crafts ?? []).map((c) => c.id).sort().join(',');
        if (craftsKey === origCraftsKey && audId === editing.audienceId) {
          setSkuPreview(editing.sku || '');
          return;
        }
      }
      const tt = setTimeout(async () => {
        try {
          const res = await productApi.skuPreview({ craftIds: craftsKey, audienceId: audId, excludeId: editing?.id });
          const d = res.data?.data;
          setSkuPreview(d?.sku || '');
        } catch { /* 预览失败静默 */ }
      }, 300);
      return () => clearTimeout(tt);
    }, [watchedCraftIds, watchedAudienceId, editing]);

    // 切换到组合模式：拉取可关联单品
    useEffect(() => {
      if (productTypeWatch === 'GROUP') ensureSingleProducts();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [productTypeWatch]);

    const resetStep = () => {
      setStepCrafts([]);
      setStepAudience(undefined);
      setStepCategory(undefined);
      setStepErr({});
      setCategories([]);
      setSelectedAudienceId(undefined);
    };

    const openCreate = () => {
      setGroupItems([]);
      setEditing(null);
      resetStep();
      setStepOpen(true);
    };

    const handleStepNext = async () => {
      const v = {
        craftIds: crafts.filter((c) => stepCrafts.some((s) => s.id === c.id)).map((c) => c.id),
        audienceId: stepAudience?.id,
        categoryId: stepCategory?.id,
      };
      const err: typeof stepErr = {};
      if (!v.craftIds.length) err.craftId = '请选择工艺';
      if (!v.audienceId) err.audienceId = '请选择受众';
      if (selectedAudienceId && categories.length > 0 && !v.categoryId) err.categoryId = '请选择品类';
      setStepErr(err);
      if (Object.keys(err).length) return;

      setStepOpen(false);
      const draft = draftRef.current;
      if (draft?.editing) {
        setEditing(draft.editing);
        setOpen(true);
        form.resetFields();
        const resumeSupply = Array.isArray(draft.values.supplyModes) && (draft.values.supplyModes as string[]).length
          ? (draft.values.supplyModes as string[])[0]
          : allowedSupplyModes[0];
        form.setFieldsValue({ ...draft.values, ...v, supplyModes: resumeSupply });
      } else {
        setEditing(null);
        setOpen(true);
        form.resetFields();
        form.setFieldsValue({ ...v, supplyModes: allowedSupplyModes[0] });
      }
      draftRef.current = null;
      if (v.audienceId) handleAudienceChange(v.audienceId);
    };

    const loadUsers = useCallback(async () => {
      try {
        const r = await userApi.listForSelect();
        if (r.data.code === 200 || r.data.code === 0) {
          setUsers(
            r.data.data
              .filter((u) => u.id !== currentUser?.id)
              .map((u) => ({ id: u.id, username: u.username, realName: u.realName ?? undefined })),
          );
        }
      } catch { /* 失败保持空 */ }
    }, [currentUser?.id]);

    const openEdit = (record: Product) => {
      setEditing(record);
      const grp = record as unknown as { items?: Array<Record<string, unknown>> };
      if (grp.items && Array.isArray(grp.items) && grp.items.length) {
        setGroupItems(
          grp.items.map((it, i) => ({
            key: `edit_${i}_${(it.productId as string) || ''}`,
            productId: (it.productId as string) || undefined,
            name: (it.name as string) || undefined,
            images: (it.images as string) || '',
            sizeL: (it.sizeL as string) || '',
            sizeW: (it.sizeW as string) || '',
            sizeH: (it.sizeH as string) || '',
            weight: (it.weight as string) || '',
            certificationIds: (it.certificationIds as string) || '',
            remark: (it.remark as string) || '',
          })),
        );
      } else {
        setGroupItems([]);
      }
      setOpen(true);
      loadUsers();
      form.resetFields();
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

    const closeEdit = () => { setGroupItems([]); setOpen(false); };

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
      draftRef.current = { values: form.getFieldsValue(true), editing };
      setOpen(false);
      setStepOpen(true);
    };

    const handleSubmit = async () => {
      if (isGroupMode) { handleGenerateGroup(); return; }
      try {
        const values = await form.validateFields();
        const extra = form.getFieldsValue(['craftIds', 'audienceId', 'categoryId']);
        const data = {
          ...cleanNullValues(extra),
          ...cleanNullValues(values),
          supplyModes: editing?.supplyModes && allowedSupplyModes.includes(editing.supplyModes)
            ? editing.supplyModes
            : allowedSupplyModes[0],
          certificationIds: Array.isArray(values.certificationIds) ? values.certificationIds.join(',') : '',
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
        setGroupItems([]);
        onSuccess();
      } catch (err: unknown) {
        const e = err as { errorFields?: unknown[]; response?: { data?: { message?: string } }; message?: string };
        if (e && Array.isArray(e.errorFields)) message.error('请检查表单必填项');
        else message.error(e?.response?.data?.message || e?.message || '保存失败');
      }
    };

    const handleGenerateGroup = async () => {
      const groupName = (form.getFieldValue('name') || '').trim();
      if (!groupName) { message.warning('请输入组合名称'); return; }
      if (groupItems.length === 0) { message.warning('请至少添加一个单品卡片'); return; }
      const invalid = groupItems.find((it) => !it.productId && !it.name?.trim());
      if (invalid) { message.warning('组合明细中快速新建单品时名称不能为空'); return; }
      try {
        const groupCraftIds: string[] = form.getFieldValue('craftIds') ?? [];
        const groupAudienceId: string | undefined = form.getFieldValue('audienceId');
        const groupCategoryId: string | undefined = form.getFieldValue('categoryId');
        const groupVisibility: 'PUBLIC' | 'PRIVATE' = form.getFieldValue('visibility') ?? 'PUBLIC';
        const groupVisibleUserIds: string[] = form.getFieldValue('visibleUserIds') ?? [];
        await productGroupApi.create({
          name: groupName,
          description: (form.getFieldValue('groupDesc') || '') || undefined,
          craftIds: groupCraftIds,
          audienceId: groupAudienceId,
          categoryId: groupCategoryId,
          visibility: groupVisibility,
          visibleUserIds: groupVisibleUserIds,
          items: groupItems.map((it) => ({
            productId: it.productId,
            name: it.name,
            images: it.images,
            sizeL: it.sizeL,
            sizeW: it.sizeW,
            sizeH: it.sizeH,
            weight: it.weight,
            certificationIds: it.certificationIds,
            remark: it.remark,
          })),
        });
        message.success('产品组已创建');
        setGroupItems([]);
        setOpen(false);
        onSuccess();
      } catch (err: any) {
        message.error(err?.response?.data?.message || '创建产品组失败');
      }
    };

    const ensureSingleProducts = useCallback(async () => {
      try {
        const res = await productApi.getList({ page: 1, pageSize: 200 });
        const list = res.data?.data?.list ?? [];
        setSingleProducts(list.map((p: Product) => ({ id: p.id, name: p.name, sku: p.sku || '' })));
      } catch { /* 静默 */ }
    }, []);

    // ---- 渲染 ----
    return (
      <>
        <Modal
          title={
            <div className="pm-modal-title">
              <span className="pm-modal-title-main">{editing ? '编辑产品' : '新建产品'}</span>
              <span className="pm-sku-head">
                {(() => {
                  const { phase, label } = getProgressPhase(editing?.progress ?? null);
                  return <Tag color={STATUS_TAG_COLOR[phase]} className="pm-sku-status">{label}</Tag>;
                })()}
                <span className={cx('pm-sku-preview', !skuPreview && 'is-empty')}>
                  {skuPreview ? skuPreview : 'SKU 待生成'}
                </span>
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
                    value={Form.useWatch('visibleUserIds', form) ?? []}
                    onChange={(next) => form.setFieldsValue({ visibleUserIds: Array.isArray(next) ? next : [] })}
                    options={users.map((u) => ({ label: u.realName || u.username, value: u.id }))}
                  />
                ) : null}
              </div>
              <button type="button" className="pm-modal-close" aria-label="关闭" onClick={closeEdit}>
                <CloseOutlined />
              </button>
            </div>
          }
          closeIcon={null}
          open={open}
          onCancel={closeEdit}
          width={1000}
          zIndex={1100}
          footer={
            editing ? (
              [
                <Button key="back" onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>,
                <Button key="cancel" onClick={closeEdit}>取消</Button>,
                <Button key="save" type="primary" onClick={handleSubmit}>保存</Button>,
              ]
            ) : productTypeWatch === 'GROUP' ? (
              <Space>
                <Button onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>
                <Button onClick={closeEdit}>取消</Button>
                <Button type="primary" onClick={handleGenerateGroup}>生成组合</Button>
              </Space>
            ) : (
              <Space>
                <Button onClick={backToStep} icon={<ArrowLeftOutlined />}>重选分类</Button>
                <Button onClick={closeEdit}>取消</Button>
                <Button type="primary" onClick={handleSubmit}>保存</Button>
              </Space>
            )
          }
        >
          <Form form={form} layout="vertical" preserve={false}>
            {/* 基础信息栏（单列整行，整合图片/认证/组合明细/基础字段） */}
            <Col xs={24} className="pm-col-stretch">
              <div className="pm-basic-wrap">
                <Form.Item name="craftIds" hidden><Input /></Form.Item>
                <Form.Item name="audienceId" hidden><Input /></Form.Item>
                <Form.Item name="categoryId" hidden><Input /></Form.Item>
                <Form.Item name="visibility" hidden initialValue="PUBLIC"><Input /></Form.Item>
                <Form.Item name="visibleUserIds" hidden><Select mode="multiple" /></Form.Item>

                {isGroupMode && (
                  <div className="pm-combo-hint" style={{ marginBottom: 14 }}>
                    组合产品：在下方「单品卡片」中填写各组成部分，新增单品卡片即自动成为组合产品。
                  </div>
                )}

                {/* 组合模式：组合信息 + 单品卡片列表（有卡片即为组合产品） */}
                {isGroupMode && (
                  <div className="pm-subblock">
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item name="name" label="组合名称" rules={[{ required: true, message: '请输入组合名称' }]} style={{ marginBottom: 14 }}>
                          <Input placeholder="输入组合名称" />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item name="groupDesc" label="组合备注" style={{ marginBottom: 14 }}>
                          <Input placeholder="组合整体说明（选填）" />
                        </Form.Item>
                      </Col>
                    </Row>

                    {groupItems.length === 0 && (
                      <div className="pm-gitem-empty" style={{ marginBottom: 12 }}>
                        暂未添加单品卡片，点击下方「+ 新增单品卡片」开始
                      </div>
                    )}
                    {groupItems.map((row, idx) => (
                      <div className="pm-product-card pm-product-card--combo" key={row.key}>
                        <div className="pm-product-card__head">
                          <span className="pm-product-card__idx">单品 {idx + 1}</span>
                          <Button type="link" danger size="small" onClick={() => setGroupItems((prev) => prev.filter((it) => it.key !== row.key))}>删除</Button>
                        </div>
                        <div className="pm-product-card__grid">
                          <div className="pm-product-card__media">
                            <ProductImageList
                              uploadUrl="/upload"
                              value={row.images}
                              onChange={(v: string) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, images: v } : it)))}
                            />
                          </div>
                          <div className="pm-product-card__body">
                            <Form.Item label="单品名称" required style={{ marginBottom: 12 }}>
                              {row.productId ? (
                                <Select showSearch placeholder="关联已有单品" optionFilterProp="label" style={{ width: '100%' }}
                                  value={row.productId}
                                  onChange={(v) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, productId: v, name: undefined } : it)))}
                                  options={singleProducts.map((p) => ({ label: p.sku ? `${p.name}（${p.sku}）` : p.name, value: p.id }))}
                                />
                              ) : (
                                <Input placeholder="快速新建单品名称" value={row.name}
                                  onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, name: e.target.value } : it)))} />
                              )}
                            </Form.Item>
                            <div className="pm-size-row">
                              <div className="pm-size-row-title">尺寸 (cm)</div>
                              <Row gutter={10}>
                                <Col span={8}>
                                  <Form.Item label="长" style={{ marginBottom: 12 }}>
                                    <Input placeholder="0" value={row.sizeL} onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, sizeL: e.target.value } : it)))} />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item label="宽" style={{ marginBottom: 12 }}>
                                    <Input placeholder="0" value={row.sizeW} onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, sizeW: e.target.value } : it)))} />
                                  </Form.Item>
                                </Col>
                                <Col span={8}>
                                  <Form.Item label="高" style={{ marginBottom: 12 }}>
                                    <Input placeholder="0" value={row.sizeH} onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, sizeH: e.target.value } : it)))} />
                                  </Form.Item>
                                </Col>
                              </Row>
                            </div>
                            <Form.Item label="克重 (g)" style={{ marginBottom: 12 }}>
                              <Input placeholder="0" value={row.weight} onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, weight: e.target.value } : it)))} />
                            </Form.Item>
                            <Form.Item label="相关证书" style={{ marginBottom: 12 }}>
                              <Select mode="multiple" placeholder="选择现有证书" allowClear optionFilterProp="label" style={{ width: '100%' }}
                                value={row.certificationIds ? row.certificationIds.split(',').filter(Boolean) : []}
                                onChange={(vals: string[]) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, certificationIds: vals.join(',') } : it)))}
                                options={certificates.map((c) => ({ label: c.code ? `${c.name}（${c.code}）` : c.name, value: c.id }))}
                              />
                            </Form.Item>
                            <Form.Item label="商品描述" style={{ marginBottom: 0 }}>
                              <Input.TextArea rows={2} placeholder="详细介绍商品特色、材质、核心功能卖点..." value={row.remark}
                                onChange={(e) => setGroupItems((prev) => prev.map((it) => (it.key === row.key ? { ...it, remark: e.target.value } : it)))} />
                            </Form.Item>
                          </div>
                        </div>
                      </div>
                    ))}
                    <Button type="dashed" block style={{ marginTop: 12 }} onClick={() => setGroupItems((prev) => [...prev, {
                      key: `gi_${Date.now()}_${prev.length}`, images: '', sizeL: '', sizeW: '', sizeH: '', weight: '', certificationIds: '', remark: '',
                    }])}>+ 新增单品卡片</Button>
                  </div>
                )}

                {/* 单品模式：产品图片到认证资质聚合成「左图右文」卡片 */}
                {!isGroupMode && (
                  <div className="pm-product-card">
                    <div className="pm-product-card__media">
                      <Form.Item name="images" label={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          产品图片
                          <Tooltip title="支持批量选择图片，第一张将作为主图；点击图片可预览（支持左右切换），也可通过星标重新设为主图。">
                            <InfoCircleOutlined style={{ color: 'var(--c-text-tertiary)', cursor: 'help' }} />
                          </Tooltip>
                        </span>
                      } style={{ marginBottom: 0 }}>
                        <ProductImageList uploadUrl="/upload" />
                      </Form.Item>
                    </div>
                    <div className="pm-product-card__body">
                      <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]} style={{ marginBottom: 14 }}>
                        <Input placeholder="输入产品名称" />
                      </Form.Item>
                      <div className="pm-size-row">
                        <div className="pm-size-row-title">尺寸 (cm)</div>
                        <Row gutter={10}>
                          <Col span={8}><Form.Item name="sizeL" label="长" style={{ marginBottom: 12 }}><Input placeholder="0" /></Form.Item></Col>
                          <Col span={8}><Form.Item name="sizeW" label="宽" style={{ marginBottom: 12 }}><Input placeholder="0" /></Form.Item></Col>
                          <Col span={8}><Form.Item name="sizeH" label="高" style={{ marginBottom: 12 }}><Input placeholder="0" /></Form.Item></Col>
                        </Row>
                      </div>
                      <Form.Item name="weight" label="克重 (g)" style={{ marginBottom: 12 }}>
                        <Input placeholder="0" />
                      </Form.Item>
                      <Form.Item name="certificationIds" label="相关证书" style={{ marginBottom: 12 }}>
                        <Select mode="multiple" placeholder="选择现有证书" allowClear optionFilterProp="label"
                          options={certificates.map((c) => ({ label: c.code ? `${c.name}（${c.code}）` : c.name, value: c.id }))} />
                      </Form.Item>
                      <Form.Item name="remark" label="商品描述" style={{ marginBottom: 0 }}>
                        <Input.TextArea rows={3} placeholder="详细介绍商品特色、材质、核心功能卖点..." />
                      </Form.Item>
                    </div>
                  </div>
                )}

                {!isGroupMode && (
                  <Button type="dashed" block icon={<PlusOutlined />} style={{ marginTop: 14 }} onClick={() => setGroupItems((prev) => [...prev, {
                    key: `gi_${Date.now()}_${prev.length}`, images: '', sizeL: '', sizeW: '', sizeH: '', weight: '', certificationIds: '', remark: '',
                  }])}>转为组合产品（新增单品卡片）</Button>
                )}
              </div>
            </Col>
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
          zIndex={1200}
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
                <Form.Item label="工艺" required validateStatus={stepErr.craftId ? 'error' : ''} help={stepErr.craftId}>
                  <Row gutter={[10, 10]}>
                    {crafts.map((c) => {
                      const checked = stepCrafts.some((s) => s.id === c.id);
                      return (
                        <Col span={8} key={c.id}>
                          <button type="button" className={cx('pm-pick', checked && 'is-selected')}
                            title={checked && stepCrafts.length === 1 ? '至少保留一个工艺' : undefined}
                            onClick={() => {
                              if (checked && stepCrafts.length === 1) return;
                              setStepCrafts((prev) => checked ? prev.filter((s) => s.id !== c.id) : [...prev, c]);
                              setStepErr((e) => ({ ...e, craftId: undefined }));
                            }}>
                            <CheckCircleFilled className="pm-pick-check" />
                            <span className="pm-pick-name">{c.name}</span>
                          </button>
                        </Col>
                      );
                    })}
                  </Row>
                </Form.Item>

                {stepCrafts.length > 0 && (
                  <Form.Item label="受众" required validateStatus={stepErr.audienceId ? 'error' : ''} help={stepErr.audienceId}>
                    <Row gutter={[10, 10]}>
                      {audiences.map((a) => (
                        <Col span={8} key={a.id}>
                          <button type="button" className={cx('pm-pick', stepAudience?.id === a.id && 'is-selected')}
                            onClick={() => {
                              setStepAudience(a);
                              setStepCategory(undefined);
                              setStepErr((e) => ({ ...e, audienceId: undefined, categoryId: undefined }));
                              setCategories(a?.categories || []);
                              setSelectedAudienceId(a.id);
                            }}>
                            <CheckCircleFilled className="pm-pick-check" />
                            <span className="pm-pick-name">{a.name}</span>
                            {a.categories?.length ? <span className="pm-pick-sub">{a.categories.length} 个品类</span> : null}
                          </button>
                        </Col>
                      ))}
                    </Row>
                  </Form.Item>
                )}

                {selectedAudienceId && (
                  <Form.Item label="品类" required validateStatus={stepErr.categoryId ? 'error' : ''} help={stepErr.categoryId}>
                    <Row gutter={[10, 10]}>
                      {categories.length ? categories.map((c) => (
                        <Col span={8} key={c.id}>
                          <button type="button" className={cx('pm-pick', stepCategory?.id === c.id && 'is-selected')}
                            onClick={() => { setStepCategory(c); setStepErr((e) => ({ ...e, categoryId: undefined })); }}>
                            <CheckCircleFilled className="pm-pick-check" />
                            <span className="pm-pick-name">{c.name}</span>
                          </button>
                        </Col>
                      )) : (
                        <Col span={24}><div className="pm-pick-empty">该受众暂无品类，可直接进入下一步</div></Col>
                      )}
                    </Row>
                  </Form.Item>
                )}
              </Form>
            </div>
          </div>
        </Modal>
      </>
    );
  },
);

ProductEditModal.displayName = 'ProductEditModal';
