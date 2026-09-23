import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getOpportunity } from '../../../api/sales';
import { createQuotation, getQuotation, updateQuotation } from '../../../api/quotations';
import { getErrorMessage } from '../../../api/request';
import { useMasterData } from '../../../hooks/useMasterData';
import ProductSelect from '../../products/ProductSelect';
import type { Currency, QuotationCreatePayload, QuotationItemInput, QuotationListItem, QuotationUpdatePayload } from '../../../types/quotation';
import {
  DETACHED_SOURCE_ITEMS_HINT,
  ITEMS_REBUILD_HINT,
  NO_SOURCE_ITEMS_HINT,
  QUOTATION_CURRENCY_OPTIONS,
  QUOTATION_DEFAULT_UNIT,
  UNIT_PRICE_REQUIRED_HINT,
  UNAVAILABLE_ITEM_PRODUCT_HINT,
} from './constants';

const { Text } = Typography;

export type QuotationFormMode = 'create' | 'edit';

interface LineValue {
  productId?: string;
  quantity?: number;
  unitPrice?: number;
}

interface QuotationFormValues {
  title: string;
  currency?: Currency;
  validUntil?: string;
  notes?: string;
  items?: LineValue[];
}

export interface QuotationFormModalProps {
  mode: QuotationFormMode;
  open: boolean;
  /** create：目标商机 id（来自商机详情入口）—— 必填且**不可更换** */
  opportunityId?: string;
  /** edit：报价 id（打开时 GET /api/quotations/:id 拉取真实数据回填） */
  quotationId?: string;
  onCancel: () => void;
  onSaved: (quotation: QuotationListItem) => void;
}

/** Decimal-string（'2.0000'）→ InputNumber 可承载的 number；非法/空 → null（仅表单层数值解析） */
const decimalToNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 明细签名（用于判断用户是否实际改动了明细）
 * 覆盖：productId · productName · productSku · quantity · unit · unitPrice（与 D-FS3-009 一致）
 */
const lineSignature = (lines: QuotationItemInput[]): string =>
  JSON.stringify(
    lines.map((line) => ({
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      productSku: line.productSku ?? null,
      quantity: line.quantity ?? null,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice ?? null,
    })),
  );

/**
 * Quotation Create / Edit 表单（Round F-S3）
 *
 * 契约边界（**严格等于**后端 createSchema 白名单中本阶段使用的键，见 types/quotation.ts）：
 *   可写：opportunityId（仅 Create）· title · currency · validUntil · notes · items[]
 *   不提交：customerId（后端由商机推导）· totalAmount（后端按明细汇总）· exchangeRate（后端解析）
 *           · status（默认 DRAFT，F-S3 状态只读）· ownerId（F-01 冻结 owner 候选源）
 *   不提供：删除报价 · 状态流转 · 版本升级 · 审批 · 归属指派 · 客户/商机更换
 *
 * 关键语义（后端源码，不臆测）：
 *   · 传 `items` ⇒ 后端**整表重建**明细（deleteMany + create）⇒ 仅在明细实际变化时才提交
 *     （否则会无损覆盖 costPrice / spec / craft / size / packaging / leadTime / remark 等本表单不承载字段）；
 *   · `unitPrice` 必须 > 0（后端 parseItems 对 `unitPrice ?? 0` 直接判非法）⇒ 表单逐行强制填写；
 *     **不**以产品标准价或商机 targetPrice 自动填充（避免把「客户目标价」当成报价单价）；
 *   · 变更 `currency` 时后端会重算 totalAmountCny，但**不会**改写已存在明细行的 currency
 *     （仅重建明细时按报价币种写入）⇒ 已作提示。
 */
export default function QuotationFormModal({
  mode,
  open,
  opportunityId,
  quotationId,
  onCancel,
  onSaved,
}: QuotationFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<QuotationFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 商机信息（create 由商机带出；edit 由报价详情带出） */
  const [opportunityInfo, setOpportunityInfo] = useState<{ id: string; opportunityNo: string; title: string } | null>(null);
  /** 产品兜底（历史明细产品不可见 / 已删除时仍可显示） */
  const [itemFallbacks, setItemFallbacks] = useState<Record<string, { id: string; name: string; sku?: string | null }>>({});
  /** 源商机明细中未关联产品的条数（无法带入报价） */
  const [detachedSourceCount, setDetachedSourceCount] = useState(0);
  /** 当前报价中「不可保留」的明细（productId 为空或产品不可用） */
  const [unusableItems, setUnusableItems] = useState<{ label: string; productId: string | null }[]>([]);
  /** 打开时的明细签名（仅在其变化时才提交 items） */
  const initialSignature = useRef<string>('');
  /** 打开时的币种（用于判断币种是否被改动） */
  const initialCurrency = useRef<Currency | undefined>(undefined);
  /** 由商机带入的明细条数（create 态用于「无可带入明细」提示） */
  const [sourceItemCount, setSourceItemCount] = useState(0);

  const { productOptions, loadProductOptions } = useMasterData();
  const isCreate = mode === 'create';

  /** productId → { name, sku }（用于提交快照：product 当前值），来自既有 master data store */
  const productMeta = useMemo(
    () => new Map(productOptions.map((option) => [option.id, option])),
    [productOptions],
  );

  useEffect(() => {
    if (!open) return;
    void loadProductOptions().catch(() => {
      /* 产品字典失败不阻塞表单：ProductSelect 会自行提示错误 */
    });
  }, [open, loadProductOptions]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOpportunityInfo(null);
    setItemFallbacks({});
    setDetachedSourceCount(0);
    setUnusableItems([]);
    form.resetFields();

    let cancelled = false;

    if (mode === 'create') {
      if (!opportunityId) {
        setError('缺少目标商机 ID');
        return;
      }
      setLoadingSource(true);
      void getOpportunity(opportunityId)
        .then((detail) => {
          if (cancelled) return;
          setOpportunityInfo({ id: detail.id, opportunityNo: detail.opportunityNo, title: detail.title });

          const fallbacks: Record<string, { id: string; name: string; sku?: string | null }> = {};
          const lines: LineValue[] = [];
          let detached = 0;
          for (const item of detail.items) {
            if (!item.productId) {
              detached += 1;
              continue;
            }
            fallbacks[item.productId] = {
              id: item.productId,
              name: item.product?.name ?? item.productName ?? '（产品不可见）',
              sku: item.product?.sku ?? null,
            };
            // 单价**留空**：商机明细的 targetPrice 为「客户目标价」语义，不作为报价单价带入
            lines.push({ productId: item.productId, quantity: item.quantity ?? 1 });
          }
          setItemFallbacks(fallbacks);
          setDetachedSourceCount(detached);
          setSourceItemCount(lines.length);
          initialCurrency.current = 'USD';
          form.setFieldsValue({
            currency: 'USD',
            items: lines.length > 0 ? lines : [{ quantity: 1 }],
          });
          initialSignature.current = ''; // create 始终提交 items
        })
        .catch((err) => {
          if (!cancelled) setError(getErrorMessage(err));
        })
        .finally(() => {
          if (!cancelled) setLoadingSource(false);
        });

      return () => {
        cancelled = true;
      };
    }

    if (!quotationId) {
      setError('缺少待编辑的报价 ID');
      return;
    }

    setLoadingSource(true);
    void getQuotation(quotationId)
      .then((detail) => {
        if (cancelled) return;
        setOpportunityInfo({
          id: detail.opportunity.id,
          opportunityNo: detail.opportunity.opportunityNo,
          title: detail.opportunity.title,
        });

        const fallbacks: Record<string, { id: string; name: string; sku?: string | null }> = {};
        const lines: LineValue[] = [];
        const unusable: { label: string; productId: string | null }[] = [];
        for (const item of detail.items) {
          const label = item.product?.name ?? item.productName ?? '（产品不可用）';
          if (!item.productId) {
            // 无关联产品的明细：本表单要求 productId ⇒ 无法保留（显式提示，不静默丢弃）
            unusable.push({ label, productId: null });
            continue;
          }
          if (!item.product) {
            // 有 productId 但产品当前不可用（不可见 / 已删除）：后端重建时会 400
            unusable.push({ label, productId: item.productId });
          }
          fallbacks[item.productId] = { id: item.productId, name: label, sku: item.product?.sku ?? item.productSku ?? null };
          lines.push({
            productId: item.productId,
            quantity: decimalToNumber(item.quantity) ?? 1,
            unitPrice: decimalToNumber(item.unitPrice) ?? undefined,
          });
        }
        setItemFallbacks(fallbacks);
        setUnusableItems(unusable);
        setSourceItemCount(lines.length);

        const currency = detail.currency;
        initialCurrency.current = currency;
        form.setFieldsValue({
          title: detail.title,
          currency,
          validUntil: detail.validUntil ? String(detail.validUntil).slice(0, 10) : undefined,
          notes: detail.notes ?? undefined,
          items: lines.length > 0 ? lines : [{ quantity: 1 }],
        });

        // 基线签名：用「提交语义」构建（与 buildItems 的输出同构），确保未改动时不提交 items
        initialSignature.current = lineSignature(
          lines
            .filter((line): line is LineValue & { productId: string } => Boolean(line.productId))
            .map((line) => ({
              productId: line.productId,
              productName: fallbacks[line.productId]?.name,
              productSku: fallbacks[line.productId]?.sku ?? null,
              quantity: line.quantity ?? 1,
              unit: QUOTATION_DEFAULT_UNIT,
              unitPrice: line.unitPrice ?? 0,
            })),
        );
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSource(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, mode, opportunityId, quotationId, form]);

  /** 表单行 → 提交载荷（productId 必填；快照名/SKU 取产品当前值，缺失时回退既有快照） */
  const buildItems = useCallback(
    (values: QuotationFormValues): QuotationItemInput[] =>
      (values.items ?? [])
        .filter((line): line is LineValue & { productId: string } => Boolean(line?.productId))
        .map((line) => {
          const meta = productMeta.get(line.productId);
          const fallback = itemFallbacks[line.productId];
          return {
            productId: line.productId,
            productName: meta?.name ?? fallback?.name,
            productSku: meta?.sku ?? fallback?.sku ?? null,
            quantity: line.quantity ?? 1,
            unit: QUOTATION_DEFAULT_UNIT,
            unitPrice: line.unitPrice ?? 0,
          };
        }),
    [itemFallbacks, productMeta],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: QuotationFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 表单校验失败（title / 明细行 productId / quantity / unitPrice）
    }

    const items = buildItems(values);
    if (items.length === 0) {
      setError('请至少添加一条报价明细');
      return;
    }

    setSubmitting(true);
    try {
      if (isCreate) {
        if (!opportunityId) throw new Error('缺少目标商机 ID');
        const payload: QuotationCreatePayload = {
          opportunityId,
          title: values.title.trim(),
          currency: values.currency ?? 'USD',
          validUntil: values.validUntil ?? null,
          notes: values.notes?.trim() ? values.notes.trim() : null,
          items,
          // 不提交 customerId / totalAmount / exchangeRate / status / ownerId（均由后端推导或不在 F-S3 范围）
        };
        const saved = await createQuotation(payload);
        message.success('创建成功');
        form.resetFields();
        onSaved(saved);
      } else {
        if (!quotationId) throw new Error('缺少待编辑的报价 ID');
        const payload: QuotationUpdatePayload = {
          title: values.title.trim(),
          validUntil: values.validUntil ?? null,
          notes: values.notes?.trim() ? values.notes.trim() : null,
        };
        // 币种仅在改动时提交（避免无谓触发后端 totalAmountCny 重算）
        if (values.currency && values.currency !== initialCurrency.current) {
          payload.currency = values.currency;
        }
        // 明细仅在用户实际改动时提交（后端会整表重建明细）
        if (lineSignature(items) !== initialSignature.current) {
          payload.items = items;
        }
        const saved = await updateQuotation(quotationId, payload);
        message.success('更新成功');
        onSaved(saved);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, isCreate, opportunityId, quotationId, buildItems, message, onSaved]);

  return (
    <Modal
      open={open}
      title={isCreate ? '新建报价' : '编辑报价'}
      width={900}
      okText={isCreate ? '创建' : '保存'}
      cancelText="取消"
      confirmLoading={submitting}
      okButtonProps={{ disabled: loadingSource }}
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
          title={isCreate ? '创建报价失败' : '保存报价失败'}
          description={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {detachedSourceCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`该商机有 ${detachedSourceCount} 条明细未关联产品`}
          description={DETACHED_SOURCE_ITEMS_HINT}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {unusableItems.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`该报价有 ${unusableItems.length} 条明细无法在本表单中保留`}
          description={
            <div>
              <div>{UNAVAILABLE_ITEM_PRODUCT_HINT}</div>
              <div>
                涉及明细：{unusableItems.slice(0, 3).map((item) => item.label).join('、')}
                {unusableItems.length > 3 ? ` 等 ${unusableItems.length} 条` : ''}
              </div>
              <div>{ITEMS_REBUILD_HINT}</div>
            </div>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Spin spinning={loadingSource}>
        <Form<QuotationFormValues> form={form} layout="vertical">
          <Form.Item label="商机" extra="报价必须归属一个商机；客户由商机推导，创建后不可更换。">
            <Input
              readOnly
              value={
                opportunityInfo
                  ? `${opportunityInfo.opportunityNo} · ${opportunityInfo.title}`
                  : isCreate
                    ? opportunityId ?? ''
                    : ''
              }
              placeholder="商机"
            />
          </Form.Item>

          <Form.Item name="title" label="报价标题" rules={[{ required: true, message: '请输入报价标题' }]}>
            <Input maxLength={200} placeholder="例如：2026 春季新款报价 V1" />
          </Form.Item>

          <Form.Item name="currency" label="币种" extra="变更币种不会改写已有明细行的币种（后端仅在重建明细时按报价币种写入）。">
            <Select options={QUOTATION_CURRENCY_OPTIONS} placeholder="币种" />
          </Form.Item>

          <Form.Item name="validUntil" label="有效期至">
            <Input type="date" />
          </Form.Item>

          <Form.Item label="报价明细" extra={UNIT_PRICE_REQUIRED_HINT} required>
            <Form.List
              name="items"
              rules={[
                {
                  validator: async (_, value: LineValue[] | undefined) => {
                    if (!value || value.filter((line) => Boolean(line?.productId)).length === 0) {
                      throw new Error('请至少添加一条报价明细');
                    }
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }} wrap>
                      <Form.Item
                        name={[field.name, 'productId']}
                        rules={[{ required: true, message: '请选择产品' }]}
                        style={{ flex: 1, marginBottom: 0, minWidth: 300 }}
                      >
                        <ProductSelect
                          placeholder="选择产品"
                          allowClear={false}
                          fallbackOption={
                            form.getFieldValue(['items', field.name, 'productId'])
                              ? itemFallbacks[form.getFieldValue(['items', field.name, 'productId']) as string] ?? null
                              : null
                          }
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'quantity']}
                        rules={[
                          { required: true, message: '请输入数量' },
                          {
                            validator: (_rule, value: number | undefined) =>
                              typeof value === 'number' && Number.isInteger(value) && value >= 1
                                ? Promise.resolve()
                                : Promise.reject(new Error('数量须为 ≥1 的整数')),
                          },
                        ]}
                        style={{ width: 130, marginBottom: 0 }}
                      >
                        <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="数量" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'unitPrice']}
                        rules={[
                          { required: true, message: '请输入报价单价' },
                          {
                            validator: (_rule, value: number | undefined) =>
                              typeof value === 'number' && value > 0
                                ? Promise.resolve()
                                : Promise.reject(new Error('单价必须大于 0')),
                          },
                        ]}
                        style={{ width: 170, marginBottom: 0 }}
                      >
                        <InputNumber min={0.000001} step={0.01} style={{ width: '100%' }} placeholder="报价单价" />
                      </Form.Item>
                      <Text type="secondary">{QUOTATION_DEFAULT_UNIT}</Text>
                      <Button type="text" danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Space size={8}>
                    <Button onClick={() => add({ quantity: 1 })}>添加明细</Button>
                    {isCreate && !loadingSource && sourceItemCount === 0 ? (
                      <Text type="secondary">{NO_SOURCE_ITEMS_HINT}</Text>
                    ) : null}
                  </Space>
                  <Form.ErrorList errors={errors} />
                </Space>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
