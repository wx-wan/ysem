import { Alert, App, Form, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createProduct, getProduct, updateProduct } from '../../api/products';
import { getErrorMessage } from '../../api/request';
import { useMasterData } from '../../hooks/useMasterData';
import type { ProductCreatePayload, ProductCurrency, ProductVisibility } from '../../types/product';
import { CURRENCY_OPTIONS, SKU_AUTO_HINT, VISIBILITY_HINT, VISIBILITY_OPTIONS } from './constants';

const { Text } = Typography;

export type ProductFormMode = 'create' | 'edit';

interface ProductFormValues {
  name: string;
  sku?: string;
  craftIds?: string[];
  audienceId?: string;
  categoryId?: string;
  /** 表单层为 number（可编辑数字输入）；提交时映射为后端 `price`（→ defaultPrice） */
  price?: number | null;
  currency?: ProductCurrency;
  stock?: number | null;
  visibility: ProductVisibility;
  description?: string;
}

export interface ProductFormModalProps {
  mode: ProductFormMode;
  open: boolean;
  /** Edit 模式必填：打开时通过 GET /api/products/:id 拉取**真实**详情回填 */
  productId?: string;
  onCancel: () => void;
  onSaved: () => void;
}

/** Decimal-string（'1200.000000'）→ InputNumber 可承载的 number；非法/空 → null */
const decimalToNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Product Create / Edit 表单（Round F-S1）
 *
 * 契约边界（**严格等于**后端 productSchema 白名单，见 types/product.ts 说明）：
 *   可写：name · sku · craftIds · audienceId · categoryId · price · currency · stock · description · visibility
 *   不写（不在白名单，后端会静默丢弃）：model · material · colors · packaging · features · moq ·
 *   leadTime · hsCode · ownerId · images/coverImage · supplyModes · certificationIds · visibleUserIds
 *
 * 关键映射（后端 buildProductCreateData / updateProduct）：
 *   price → defaultPrice · currency → defaultCurrency（非法值后端回落 USD）
 *
 * 校验：只实现后端明确要求者（name 必填）；不新增格式校验、不推断业务规则。
 * UI：全部复用 antd 现有基础组件（Form / Input / InputNumber / Select / Modal / Alert / Spin）。
 */
export default function ProductFormModal({ mode, open, productId, onCancel, onSaved }: ProductFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ProductFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { crafts, audiences, categories, loadProductTaxonomy } = useMasterData();
  const audienceId = Form.useWatch('audienceId', form);

  // 字典（工艺 / 受众 / 品类）仅在打开时确保加载（TTL 缓存内不重复请求）
  useEffect(() => {
    if (!open) return;
    void loadProductTaxonomy().catch(() => {
      /* 字典失败不阻塞表单：Select 保持空态，历史值仍可保留 */
    });
  }, [open, loadProductTaxonomy]);

  // 打开时：Create → 重置为默认值；Edit → 拉取真实详情回填
  useEffect(() => {
    if (!open) return;
    setError(null);
    form.resetFields();

    if (mode === 'create') {
      form.setFieldsValue({ visibility: 'PUBLIC', currency: 'USD' });
      return;
    }
    if (!productId) {
      setError('缺少待编辑的产品 ID');
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void getProduct(productId)
      .then((detail) => {
        if (cancelled) return;
        form.setFieldsValue({
          name: detail.name,
          sku: detail.sku ?? undefined,
          craftIds: detail.crafts.map((craft) => craft.id),
          audienceId: detail.audience?.id ?? undefined,
          categoryId: detail.category?.id ?? undefined,
          price: decimalToNumber(detail.defaultPrice),
          currency: detail.defaultCurrency,
          stock: detail.stock,
          visibility: detail.visibility,
          description: detail.description ?? undefined,
        });
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, productId, form]);

  /** 品类随受众收敛（ProductCategory.audienceId 为真实字段）；未选受众时展示全部品类 */
  const categoryOptions = useMemo(
    () =>
      categories
        .filter((category) => !audienceId || category.audienceId === audienceId)
        .map((category) => ({ label: category.name, value: category.id })),
    [categories, audienceId],
  );

  const craftOptions = useMemo(() => crafts.map((craft) => ({ label: craft.name, value: craft.id })), [crafts]);
  const audienceOptions = useMemo(() => audiences.map((item) => ({ label: item.name, value: item.id })), [audiences]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: ProductFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 表单校验失败（仅 name 必填）
    }

    const payload: ProductCreatePayload = {
      name: values.name.trim(),
      sku: values.sku?.trim() ? values.sku.trim() : null,
      craftIds: values.craftIds ?? [],
      audienceId: values.audienceId ?? null,
      categoryId: values.categoryId ?? null,
      price: values.price ?? null,
      currency: values.currency ?? null,
      stock: values.stock ?? null,
      description: values.description?.trim() ? values.description.trim() : null,
      visibility: values.visibility,
    };

    setSubmitting(true);
    try {
      if (mode === 'create') {
        await createProduct(payload);
        message.success('创建成功');
      } else {
        if (!productId) throw new Error('缺少待编辑的产品 ID');
        await updateProduct(productId, payload);
        message.success('更新成功');
      }
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, mode, productId, message, onSaved]);

  const isCreate = mode === 'create';

  return (
    <Modal
      open={open}
      title={isCreate ? '新建产品' : '编辑产品'}
      width={720}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loadingDetail }}
      onOk={() => void handleSubmit()}
      onCancel={() => {
        setError(null);
        onCancel();
      }}
    >
      {error ? (
        <Alert
          type="error"
          showIcon
          title={isCreate ? '创建产品失败' : '保存产品失败'}
          description={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Spin spinning={loadingDetail}>
        <Form<ProductFormValues>
          form={form}
          layout="vertical"
          initialValues={{ visibility: 'PUBLIC', currency: 'USD' }}
        >
          <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
            <Input maxLength={200} placeholder="产品名称" />
          </Form.Item>

          <Form.Item name="sku" label="SKU" extra={SKU_AUTO_HINT}>
            <Input maxLength={100} placeholder="留空自动生成" />
          </Form.Item>

          <Form.Item name="audienceId" label="目标人群">
            <Select
              allowClear
              showSearch
              options={audienceOptions}
              optionFilterProp="label"
              placeholder="目标人群"
              onChange={() => form.setFieldValue('categoryId', undefined)}
            />
          </Form.Item>

          <Form.Item name="categoryId" label="产品品类">
            <Select
              allowClear
              showSearch
              options={categoryOptions}
              optionFilterProp="label"
              placeholder={audienceId ? '产品品类' : '产品品类（可先选择目标人群以收敛）'}
            />
          </Form.Item>

          <Form.Item name="craftIds" label="工艺">
            <Select mode="multiple" allowClear options={craftOptions} optionFilterProp="label" placeholder="可多选" />
          </Form.Item>

          <Form.Item name="price" label="标准价">
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="标准价（唯一标准价来源）" />
          </Form.Item>

          <Form.Item name="currency" label="币种">
            <Select allowClear options={CURRENCY_OPTIONS} placeholder="币种" />
          </Form.Item>

          <Form.Item name="stock" label="库存">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="库存数量" />
          </Form.Item>

          <Form.Item name="visibility" label="可见性" extra={VISIBILITY_HINT}>
            <Select options={VISIBILITY_OPTIONS} placeholder="可见性" />
          </Form.Item>

          <Form.Item name="description" label="产品描述">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>

          <Space size={4}>
            <Text type="secondary">
              产品编号由系统在创建时自动分配；工艺与目标人群同时存在时 SKU 自动生成。
            </Text>
          </Space>
        </Form>
      </Spin>
    </Modal>
  );
}
