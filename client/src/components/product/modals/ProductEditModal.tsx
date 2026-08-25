import React, { forwardRef, useImperativeHandle, useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { App } from 'antd';
import {
  Form, Input, InputNumber, Select, Button, Tag, Divider, Spin, Row, Col,
} from 'antd';
import AppModal from '../../../components/AppModal';
import {
  CheckCircleFilled, ReloadOutlined, ArrowLeftOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../../../stores/useAuthStore';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory, ProductGroupItemInput, productGroupApi, taxonomyApi,
} from '../../../api/products';
import { certificateApi, Certificate } from '../../../api/certificates';
import { userApi } from '../../../api/users';
import { StepBar } from '../../../components/common/StepBar';
import ProductImageList from '../../../components/common/ProductImageList';

export interface ProductEditModalHandle {
  open: (record?: Product | null, initial?: { name?: string }) => void;
}

interface ProductEditModalProps {
  crafts: ProductCraft[];
  audiences: ProductAudience[];
  /** 嵌套模式：仅做单品创建，隐藏「再建一个 / 生成组合」按钮，创建后回传 id 给父级 */
  nested?: boolean;
  /** 嵌套模式下，成功创建单品后回传新记录 id（用于父级累计组合序列） */
  onCreated?: (productId: string) => void;
  /** 创建 / 更新成功后回调（用于刷新列表，带回保存后的产品对象） */
  onSuccess?: (saved?: Product) => void;
}

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

const cleanNullValues = (obj: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([key, value]) => {
    out[key] = value === null ? undefined : value;
  });
  return out;
};

const buildVisibility = (values: Record<string, unknown>) =>
  (values.visibility as string) || 'PUBLIC';

const buildCraftIds = (values: Record<string, unknown>) =>
  Array.isArray(values.craftIds) ? (values.craftIds as string[]) : [];

const buildVisibleUserIds = (values: Record<string, unknown>) =>
  (values.visibility as string) === 'PRIVATE' && Array.isArray(values.visibleUserIds)
    ? (values.visibleUserIds as string[])
    : [];

// 证书后端以逗号分隔字符串存储，表单多选 Select 用数组，这里做双向转换
const splitCertIds = (v: unknown): string[] => {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string' && v) return v.split(',').filter(Boolean);
  return [];
};
const joinCertIds = (values: Record<string, unknown>): string =>
  splitCertIds(values.certificationIds).join(',');

// 非负浮点数输入：基于 antd InputNumber，stringMode 保持字符串以兼容后端存储
const FloatInput = (props: React.ComponentProps<typeof InputNumber> & { allowClear?: boolean }) => {
  // InputNumber 不支持 allowClear，避免透传到 DOM 触发 React 警告
  const { allowClear, ...rest } = props;
  return (
    <InputNumber
      min={0}
      precision={2}
      step={0.1}
      stringMode
      style={{ width: '100%' }}
      {...rest}
    />
  );
};

export const ProductEditModal = forwardRef<ProductEditModalHandle, ProductEditModalProps>(
  ({ crafts, audiences, nested, onCreated, onSuccess }, ref) => {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { user: currentUser } = useAuthStore();

    const [form] = Form.useForm();
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState<Product | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // 第一步：分类选择（工艺 / 受众 / 品类）
    const [stepOpen, setStepOpen] = useState(false);
    const [stepCrafts, setStepCrafts] = useState<{ id: string; name: string }[]>([]);
    const [stepAudience, setStepAudience] = useState<ProductAudience | undefined>();
    const [stepCategory, setStepCategory] = useState<ProductCategory | undefined>();
    const [stepErr, setStepErr] = useState<{ craftId?: string; audienceId?: string; categoryId?: string }>({});

    const [categories, setCategories] = useState<ProductCategory[]>([]);
    const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();
    const [users, setUsers] = useState<{ id: string; username: string; realName: string | null }[]>([]);
    const [certificates, setCertificates] = useState<Certificate[]>([]);
    const [visValue, setVisValue] = useState<string>('PUBLIC');
    const [skuPreview, setSkuPreview] = useState<string>('');
    const watchedVisibleUserIds = Form.useWatch('visibleUserIds', form) as string[] | undefined;

    // 本次新建会话累计的单品序列（仅顶层弹窗维护；嵌套弹窗创建后通过 onCreated 回传）
    const [createdSingleIds, setCreatedSingleIds] = useState<string[]>([]);

    // 嵌套「再建一个」弹窗
    const nestedRef = useRef<ProductEditModalHandle>(null);
    const handleNestedCreated = (id: string) => setCreatedSingleIds((p) => [...p, id]);

    // 主弹窗内"重选分类"模式：不再清空已填表单，仅回写分类到表单隐藏字段
    const [reselectMode, setReselectMode] = useState(false);
    // 新建时预填的产品名称（线索建档等场景带入）
    const [initialName, setInitialName] = useState('');

    const isEdit = !!editing;

    const watchedCraftIds = Form.useWatch('craftIds', form) as string[] | undefined;
    const watchedAudienceId = Form.useWatch('audienceId', form) as string | undefined;

    // 受众变化联动品类（品类选择已收归「选择分类」第一步，此处仅维护 categories 联动数据）
    const handleAudienceChange = (audienceId?: string) => {
      setSelectedAudienceId(audienceId);
      const aud = audiences.find((a) => a.id === audienceId);
      setCategories(aud?.categories || []);
    };

    // SKU 自动预览（按 工艺-受众）
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
          setSkuPreview(res.data?.data?.sku || '');
        } catch { /* 预览失败静默 */ }
      }, 300);
      return () => clearTimeout(tt);
    }, [watchedCraftIds, watchedAudienceId, editing]);

    useEffect(() => {
      if (!open) return;
      userApi.list({ pageSize: 200 }).then((r) => setUsers(r.data?.data?.list ?? [])).catch(() => {});
      certificateApi.list().then((r) => setCertificates(r.data?.data ?? [])).catch(() => {});
    }, [open]);

    useImperativeHandle(ref, () => ({
      open: (record?: Product | null, initial?: { name?: string }) => {
        if (record) {
          setEditing(record);
          setCreatedSingleIds([]);
          // 初始化分类状态，使左上角 SKU/分类标签与新建一致，并作为重选分类默认
          const aud = audiences.find((a) => a.id === record.audienceId);
          setStepAudience(aud);
          setCategories(aud?.categories || []);
          setStepCategory(aud?.categories?.find((c) => c.id === record.categoryId));
          setStepCrafts(Array.isArray(record.crafts) ? record.crafts.map((c) => ({ ...c })) : []);
          setOpen(true);
          const values: Record<string, unknown> = {
            name: record.name ?? '',
            images: record.images ?? '',
            craftIds: Array.isArray(record.crafts) ? record.crafts.map((c) => c.id) : [],
            audienceId: record.audienceId ?? undefined,
            categoryId: record.categoryId ?? undefined,
            weight: record.weight ?? '',
            certificationIds: splitCertIds(record.certificationIds),
            sizeL: record.sizeL ?? '',
            sizeW: record.sizeW ?? '',
            sizeH: record.sizeH ?? '',
            visibility: record.visibility ?? 'PUBLIC',
            visibleUserIds: Array.isArray(record.visibleUsers)
              ? record.visibleUsers.map((v) => v.userId)
              : [],
            description: record.description ?? '',
          };
          setVisValue((values.visibility as string) || 'PUBLIC');
          if (record.audienceId) handleAudienceChange(record.audienceId);
          setTimeout(() => form.setFieldsValue(values), 0);
        } else {
          // 新建：先走「选择分类」第一步
          setInitialName(initial?.name ?? '');
          setEditing(null);
          setCreatedSingleIds([]);
          setStepCrafts([]);
          setStepAudience(undefined);
          setStepCategory(undefined);
          setStepErr({});
          setCategories([]);
          setSelectedAudienceId(undefined);
          setStepOpen(true);
        }
      },
    }));

    const handleStepNext = () => {
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

      // 同步选中的分类状态对象，确保标题标签与后续回写一致
      const selectedCrafts = crafts.filter((c) => stepCrafts.some((s) => s.id === c.id));
      const selectedAudience = audiences.find((a) => a.id === v.audienceId);
      const selectedCategory = categories.find((c) => c.id === v.categoryId);
      setStepCrafts(selectedCrafts);
      setStepAudience(selectedAudience);
      setStepCategory(selectedCategory);
      setStepOpen(false);

      // 主弹窗内重选分类：仅回写隐藏字段并刷新 SKU 预览，不清空已填内容
      if (reselectMode) {
        setReselectMode(false);
        form.setFieldsValue({
          craftIds: v.craftIds,
          audienceId: v.audienceId,
          categoryId: v.categoryId,
        });
        if (v.audienceId) handleAudienceChange(v.audienceId);
        return;
      }

      setEditing(null);
      setOpen(true);
      form.resetFields();
      form.setFieldsValue({ ...v, visibility: 'PUBLIC', ...(initialName ? { name: initialName } : {}) });
      setVisValue('PUBLIC');
      if (v.audienceId) handleAudienceChange(v.audienceId);
    };

    // 主弹窗内重选分类：保留上一次分类作为默认，仅切换为回写模式打开
    const openReselectCategory = () => {
      setStepErr({});
      setReselectMode(true);
      setStepOpen(true);
    };

    const handleSubmit = async (opts?: { openNext?: boolean }) => {
      try {
        const values = await form.validateFields();
        if (!values.name || !String(values.name).trim()) {
          message.warning('请填写产品名称');
          return;
        }
        setSubmitting(true);
        const payload: Partial<Product> = {
          ...(cleanNullValues(values) as Partial<Product>),
          visibility: buildVisibility(values),
          craftIds: buildCraftIds(values),
          visibleUserIds: buildVisibleUserIds(values),
          certificationIds: joinCertIds(values),
        } as Partial<Product>;
        // 尺寸/克重后端以字符串存储；编辑回填为数字时需统一转字符串，否则 Zod 校验失败
        (['sizeL', 'sizeW', 'sizeH', 'weight'] as const).forEach((k) => {
          const v = (values as Record<string, unknown>)[k];
          (payload as Record<string, unknown>)[k] = v === undefined || v === null || v === '' ? null : String(v);
        });
        let newId: string | undefined;
        let saved: Product | undefined = editing ?? undefined;
        if (editing) {
          const res = await productApi.update(editing.id, payload);
          saved = (res as any)?.data?.data ?? (res as any)?.data ?? res as unknown as Product;
          message.success('更新成功');
        } else {
          const res = await productApi.create(payload);
          const created = (res as any)?.data?.data ?? (res as any)?.data ?? res;
          newId = created?.id;
          saved = created;
          message.success('单品创建成功');
        }
        onSuccess?.(saved);
        if (!nested && newId) setCreatedSingleIds((p) => [...p, newId as string]);
        if (nested && newId) onCreated?.(newId);
        if (nested) {
          setOpen(false);
          return;
        }
        if (opts?.openNext) {
          // 保存当前并再建一个：保留上一次分类作为默认，回到「选择分类」第一步开新单品
          setStepErr({});
          setCategories([]);
          setSelectedAudienceId(undefined);
          form.resetFields();
          setStepOpen(true);
        } else {
          setOpen(false);
        }
      } catch (err) {
        // 表单校验错误不弹额外提示；业务错误（500 等）由 request.ts 拦截器统一展示后端 message
        if (err && typeof err === 'object' && 'errorFields' in err) return;
      } finally {
        setSubmitting(false);
      }
    };

    const renderFooter = () => {
      if (nested) {
        return <Button type="primary" loading={submitting} onClick={() => handleSubmit()}>保存单品</Button>;
      }
      if (isEdit) {
        return [
          <Button key="prev" icon={<ArrowLeftOutlined />} onClick={openReselectCategory} disabled={submitting}>
            上一步
          </Button>,
          <Button key="save" type="primary" loading={submitting} onClick={() => handleSubmit()}>
            更新
          </Button>,
        ];
      }
      return [
        <Button key="prev" icon={<ArrowLeftOutlined />} onClick={openReselectCategory} disabled={submitting}>
          上一步
        </Button>,
        <Button key="cancel" onClick={() => setOpen(false)}>取消</Button>,
        <Button key="save" type="primary" loading={submitting} onClick={() => handleSubmit()}>
          保存
        </Button>,
      ];
    };

    return (
      <>
        {/* 第一步：选择分类（工艺 / 受众 / 品类） */}
        <AppModal
          open={stepOpen}
          onClose={() => setStepOpen(false)}
          title={isEdit ? '重选分类' : '新建产品 · 选择分类'}
          width={680}
          maskClosable={false}
          bodyPadding={24}
          footer={(
            <>
              <Button onClick={() => setStepOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleStepNext}>下一步</Button>
            </>
          )}
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
                <div className="pm-step-field">
                  <div className="pm-form-label">工艺</div>
                  {stepErr.craftId && <div className="pm-step-err">{stepErr.craftId}</div>}
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
                              if (checked && stepCrafts.length === 1) return;
                              setStepCrafts((prev) => (checked ? prev.filter((s) => s.id !== c.id) : [...prev, c]));
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
                </div>

                {stepCrafts.length > 0 && (
                  <div className="pm-step-field">
                    <div className="pm-form-label">受众</div>
                    {stepErr.audienceId && <div className="pm-step-err">{stepErr.audienceId}</div>}
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
                              setCategories(a?.categories || []);
                              setSelectedAudienceId(a.id);
                            }}
                          >
                            <CheckCircleFilled className="pm-pick-check" />
                            <span className="pm-pick-name">{a.name}</span>
                            {a.categories?.length ? <span className="pm-pick-sub">{a.categories.length} 个品类</span> : null}
                          </button>
                        </Col>
                      ))}
                    </Row>
                  </div>
                )}

                {selectedAudienceId && (
                  <div className="pm-step-field">
                    <div className="pm-form-label">品类</div>
                    {stepErr.categoryId && <div className="pm-step-err">{stepErr.categoryId}</div>}
                    <Row gutter={[10, 10]}>
                      {categories.length ? categories.map((c) => (
                        <Col span={8} key={c.id}>
                          <button
                            type="button"
                            className={cx('pm-pick', stepCategory?.id === c.id && 'is-selected')}
                            onClick={() => { setStepCategory(c); setStepErr((e) => ({ ...e, categoryId: undefined })); }}
                          >
                            <CheckCircleFilled className="pm-pick-check" />
                            <span className="pm-pick-name">{c.name}</span>
                          </button>
                        </Col>
                      )) : (
                        <Col span={24}><div className="pm-pick-empty">该受众暂无品类，可直接进入下一步</div></Col>
                      )}
                    </Row>
                  </div>
                )}
                </Form>
            </div>
          </div>
        </AppModal>

        {/* 主弹窗：单品卡片 */}
        <AppModal
          open={open}
          onClose={() => setOpen(false)}
          title={
            <div className="pm-modal-title">
              <span className="pm-modal-title-main">{isEdit ? t('product.editTitle') : t('product.addTitle')}</span>
              <span className="pm-sku-head">
                <span className={cx('pm-sku-preview', !skuPreview && 'is-empty')}>
                  {skuPreview ? skuPreview : (editing?.sku || 'SKU 待生成')}
                </span>
                <span className="pm-sku-tags">
                  {stepCrafts.length ? stepCrafts.map((c) => c.name).join('、') : ''}
                  {stepAudience?.name ? ` / ${stepAudience.name}` : ''}
                  {stepCategory?.name ? ` / ${stepCategory.name}` : ''}
                </span>
              </span>
            </div>
          }
          extra={
            <div className="pm-modal-actions">
              <div className="pm-vis-switch" role="group" aria-label={t('product.visibility')}>
                <button
                  type="button"
                  className={visValue === 'PUBLIC' ? 'pm-vis-opt is-active' : 'pm-vis-opt'}
                  onClick={() => { setVisValue('PUBLIC'); form.setFieldsValue({ visibility: 'PUBLIC' }); }}
                >
                  {t('product.visibilityPublic')}
                </button>
                <button
                  type="button"
                  className={visValue === 'PRIVATE' ? 'pm-vis-opt is-active' : 'pm-vis-opt'}
                  onClick={() => { setVisValue('PRIVATE'); form.setFieldsValue({ visibility: 'PRIVATE' }); }}
                >
                  {t('product.visibilityPrivate')}
                </button>
              </div>
              {visValue === 'PRIVATE' && (
                <Select
                  mode="multiple"
                  size="small"
                  allowClear
                  placeholder={t('product.visibleUsersPlaceholder')}
                  className="pm-vis-users"
                  value={watchedVisibleUserIds}
                  onChange={(v) => form.setFieldsValue({ visibleUserIds: v })}
                  options={users
                    .filter((u) => u.id !== currentUser?.id)
                    .map((u) => ({ label: u.realName || u.username, value: u.id }))}
                />
              )}
            </div>
          }
          footer={renderFooter()}
          width={860}
          maskClosable={false}
          bodyPadding={24}
        >
          <Spin spinning={submitting}>
            <Form form={form} layout="vertical" preserve={false}>
              <Form.Item name="craftIds" hidden><Input /></Form.Item>
              <Form.Item name="audienceId" hidden><Input /></Form.Item>
              <Form.Item name="categoryId" hidden><Input /></Form.Item>
              <Form.Item name="visibility" hidden initialValue="PUBLIC"><Input /></Form.Item>
              <Form.Item name="visibleUserIds" hidden><Select mode="multiple" /></Form.Item>

              <div className="pm-product-card">
                <div className="pm-product-card__media">
                  <Form.Item name="images" valuePropName="value" style={{ marginBottom: 0 }}>
                    <ProductImageList uploadUrl="/upload" />
                  </Form.Item>
                </div>
                <div className="pm-product-card__body">
                  <Form.Item name="name" label={t('product.name')} rules={[{ required: true, message: t('product.nameRequired') }]} style={{ marginBottom: 14 }}>
                    <Input placeholder={t('product.namePlaceholder')} allowClear />
                  </Form.Item>

                  <div className="pm-size-row">
                    <Row gutter={10}>
                      <Col span={6}><Form.Item name="sizeL" label={t('product.sizeL')} style={{ marginBottom: 12 }}><FloatInput placeholder="0" /></Form.Item></Col>
                      <Col span={6}><Form.Item name="sizeW" label={t('product.sizeW')} style={{ marginBottom: 12 }}><FloatInput placeholder="0" /></Form.Item></Col>
                      <Col span={6}><Form.Item name="sizeH" label={t('product.sizeH')} style={{ marginBottom: 12 }}><FloatInput placeholder="0" /></Form.Item></Col>
                      <Col span={6}><Form.Item name="weight" label={t('product.weight')} style={{ marginBottom: 12 }}><FloatInput placeholder={t('product.weightPlaceholder')} allowClear /></Form.Item></Col>
                    </Row>
                  </div>
                  <Form.Item name="certificationIds" label={t('product.certificates')} style={{ marginBottom: 12 }}>
                    <Select mode="multiple" placeholder={t('product.certificatesPlaceholder')} allowClear optionFilterProp="label"
                      options={certificates.map((c) => ({ label: c.code ? `${c.name}（${c.code}）` : c.name, value: c.id }))} />
                  </Form.Item>
                  <Form.Item name="description" label="描述" style={{ marginBottom: 0 }}>
                      <Input.TextArea rows={3} placeholder="填写产品描述" />
                    </Form.Item>
                  </div>
                </div>

              {isEdit && Array.isArray((editing as unknown as { items?: unknown[] }).items) &&
                ((editing as unknown as { items?: unknown[] }).items?.length ?? 0) > 0 && (
                  <div className="pm-prod-section">
                    <Divider style={{ margin: '16px 0 12px' }}>
                      <Tag color="blue">
                        {t('product.comboTag', { n: (editing as unknown as { items?: unknown[] }).items?.length })}
                      </Tag>
                    </Divider>
                    <p style={{ color: '#999', fontSize: 12 }}>{t('product.comboEditHint')}</p>
                  </div>
                )}

              {!isEdit && createdSingleIds.length > 0 && (
                <div className="pm-prod-section">
                  <Divider style={{ margin: '16px 0 12px' }}>
                    <Tag color="green">{t('product.createdSeq', { n: createdSingleIds.length })}</Tag>
                  </Divider>
                  <p style={{ color: '#999', fontSize: 12 }}>{t('product.createdSeqHint')}</p>
                </div>
              )}
            </Form>
          </Spin>
        </AppModal>

        {/* 嵌套「再建一个」弹窗 */}
        {!nested && (
          <ProductEditModal
            ref={nestedRef}
            nested
            crafts={crafts}
            audiences={audiences}
            onCreated={handleNestedCreated}
            onSuccess={onSuccess}
          />
        )}
      </>
    );
  },
);

ProductEditModal.displayName = 'ProductEditModal';
export default ProductEditModal;
