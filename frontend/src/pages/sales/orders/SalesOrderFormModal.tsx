import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSalesOrder, createSalesOrder, updateSalesOrder } from '../../../api/salesOrders';
import { getQuotation } from '../../../api/quotations';
import { getErrorMessage } from '../../../api/request';
import { useMasterData } from '../../../hooks/useMasterData';
import ProductSelect from '../../products/ProductSelect';
import type {
  Currency,
  SalesOrderCreatePayload,
  SalesOrderItemInput,
  SalesOrderListItem,
  SalesOrderUpdatePayload,
} from '../../../types/salesOrder';
import {
  CREATE_STATUS_HINT,
  ITEM_VALIDATION_HINT,
  ITEMS_LOCKED_HINT,
  ITEMS_REBUILD_HINT,
  ORDER_CURRENCY_OPTIONS,
  ORDER_DEFAULT_UNIT,
  UNAVAILABLE_ITEM_PRODUCT_HINT,
} from './constants';

const { Text } = Typography;

export type SalesOrderFormMode = 'create' | 'edit';

interface LineValue {
  productId?: string;
  productName?: string;
  productSku?: string;
  spec?: string;
  craft?: string;
  size?: string;
  packaging?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  remark?: string;
}

interface SalesOrderFormValues {
  currency?: Currency;
  orderDate?: string;
  deliveryDate?: string;
  actualDeliveryDate?: string;
  tradeTerms?: string;
  paymentTerms?: string;
  portOfLoading?: string;
  portOfDischarge?: string;
  cancelReason?: string;
  remark?: string;
  items?: LineValue[];
}

export interface SalesOrderFormModalProps {
  mode: SalesOrderFormMode;
  open: boolean;
  /** create：来源报价 id（**唯一创建入口** — D-FS4-002） */
  quotationId?: string;
  /** edit：订单 id */
  salesOrderId?: string;
  onCancel: () => void;
  onSaved: (order: SalesOrderListItem) => void;
}

/** Decimal-string → InputNumber 数值（仅表单层解析） */
const decimalToNumber = (raw: string | null | undefined): number | null => {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 明细签名（D-FS4-022；覆盖 ≥14 字段）
 * material / colors / sort 本阶段**不提交**（后端自 Product 填充 / 按数组序生成），故取常量参与签名。
 */
const lineSignature = (lines: SalesOrderItemInput[]): string =>
  JSON.stringify(
    lines.map((line) => ({
      productId: line.productId ?? null,
      productName: line.productName ?? null,
      productSku: line.productSku ?? null,
      spec: line.spec ?? null,
      craft: line.craft ?? null,
      size: line.size ?? null,
      material: null,
      packaging: line.packaging ?? null,
      colors: null,
      quantity: line.quantity ?? null,
      unit: line.unit ?? null,
      unitPrice: line.unitPrice ?? null,
      remark: line.remark ?? null,
      sort: null,
    })),
  );

/**
 * SalesOrder Create / Edit 表单（Round F-S4 · 依据 D-FS4-001~034）
 *
 * 创建：唯一入口 = 报价详情「创建销售订单」→ 本弹窗（商机/客户/报价只读，明细自报价带出）。
 *   · 提交 `status: 'CONFIRMED'`（D-FS4-013：后端出运门限排除 DRAFT，链路衔接所需，非状态机）；
 *   · 不提交 customerId（后端由商机推导）· totalAmount（后端汇总）· exchangeRate（后端解析）· ownerId；
 *   · customerId 的 UI 只读：客户经 报价 → 商机 推导（D-FS4-005）。
 * 编辑：仅 remark/日期/条款/港口/取消原因（+ currency 改动时）+ items（**仅明细变化时** — D-FS4-021）。
 */
export default function SalesOrderFormModal({
  mode,
  open,
  quotationId,
  salesOrderId,
  onCancel,
  onSaved,
}: SalesOrderFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SalesOrderFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 只读展示：客户 / 商机 / 报价 */
  const [refs, setRefs] = useState<{
    customer: string;
    opportunity: string;
    quotation: string;
  } | null>(null);
  /** 提交所需的固定键（来自报价或既有订单） */
  const [keys, setKeys] = useState<{ opportunityId: string; quotationId: string } | null>(null);
  const [itemFallbacks, setItemFallbacks] = useState<Record<string, { id: string; name: string; sku?: string | null }>>({});
  /** 无法在本表单保留的明细（productId 为空 / 关联产品不可用 — D-FS4-012） */
  const [unusableItems, setUnusableItems] = useState<string[]>([]);
  const [sourceItemCount, setSourceItemCount] = useState(0);

  const initialSignature = useRef<string>('');
  const initialCurrency = useRef<Currency | undefined>(undefined);

  const { productOptions, loadProductOptions } = useMasterData();
  const isCreate = mode === 'create';
  const productMeta = useMemo(() => new Map(productOptions.map((o) => [o.id, o])), [productOptions]);

  useEffect(() => {
    if (!open) return;
    void loadProductOptions().catch(() => {
      /* 产品字典失败不阻塞表单 */
    });
  }, [open, loadProductOptions]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setRefs(null);
    setKeys(null);
    setItemFallbacks({});
    setUnusableItems([]);
    setSourceItemCount(0);
    form.resetFields();

    let cancelled = false;

    if (mode === 'create') {
      if (!quotationId) {
        setError('缺少来源报价 ID');
        return;
      }
      setLoadingSource(true);
      void getQuotation(quotationId)
        .then((quotation) => {
          if (cancelled) return;
          setKeys({ opportunityId: quotation.opportunityId, quotationId: quotation.id });
          setRefs({
            customer: quotation.customer.companyName,
            opportunity: `${quotation.opportunity.opportunityNo} · ${quotation.opportunity.title}`,
            quotation: `${quotation.quotationNo} · ${quotation.title}`,
          });

          const fallbacks: Record<string, { id: string; name: string; sku?: string | null }> = {};
          const lines: LineValue[] = [];
          for (const item of quotation.items) {
            if (!item.productId) continue; // 报价可含无产品行；订单本阶段要求 productId
            fallbacks[item.productId] = {
              id: item.productId,
              name: item.product?.name ?? item.productName ?? '（产品不可用）',
              sku: item.product?.sku ?? item.productSku ?? null,
            };
            lines.push({
              productId: item.productId,
              productName: item.product?.name ?? item.productName ?? undefined,
              productSku: item.product?.sku ?? item.productSku ?? undefined,
              spec: item.spec ?? undefined,
              craft: item.craft ?? undefined,
              size: item.size ?? undefined,
              packaging: item.packaging ?? undefined,
              quantity: decimalToNumber(item.quantity) ?? 1,
              unit: item.unit ?? ORDER_DEFAULT_UNIT,
              unitPrice: decimalToNumber(item.unitPrice) ?? undefined,
              remark: item.remark ?? undefined,
            });
          }
          setItemFallbacks(fallbacks);
          setSourceItemCount(lines.length);
          initialCurrency.current = quotation.currency;
          form.setFieldsValue({
            currency: quotation.currency,
            items: lines.length > 0 ? lines : [{ quantity: 1, unit: ORDER_DEFAULT_UNIT }],
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

    if (!salesOrderId) {
      setError('缺少待编辑的订单 ID');
      return;
    }

    setLoadingSource(true);
    void getSalesOrder(salesOrderId)
      .then((order) => {
        if (cancelled) return;
        setKeys({ opportunityId: order.opportunityId, quotationId: order.quotationId ?? '' });
        setRefs({
          customer: order.customer.companyName,
          opportunity: `${order.opportunity.opportunityNo} · ${order.opportunity.title}`,
          quotation: order.quotation ? `${order.quotation.quotationNo} · ${order.quotation.title}` : '-',
        });

        const fallbacks: Record<string, { id: string; name: string; sku?: string | null }> = {};
        const lines: LineValue[] = [];
        const unusable: string[] = [];
        for (const item of order.items) {
          const label = item.product?.name ?? item.productName ?? '（产品不可用）';
          if (!item.productId) {
            unusable.push(label);
            continue;
          }
          if (!item.product) unusable.push(label);
          fallbacks[item.productId] = { id: item.productId, name: label, sku: item.product?.sku ?? item.productSku ?? null };
          lines.push({
            productId: item.productId,
            productName: item.product?.name ?? item.productName ?? undefined,
            productSku: item.product?.sku ?? item.productSku ?? undefined,
            spec: item.spec ?? undefined,
            craft: item.craft ?? undefined,
            size: item.size ?? undefined,
            packaging: item.packaging ?? undefined,
            quantity: decimalToNumber(item.quantity) ?? 1,
            unit: item.unit ?? ORDER_DEFAULT_UNIT,
            unitPrice: decimalToNumber(item.unitPrice) ?? undefined,
            remark: item.remark ?? undefined,
          });
        }
        setItemFallbacks(fallbacks);
        setUnusableItems(unusable);
        setSourceItemCount(lines.length);
        initialCurrency.current = order.currency;
        form.setFieldsValue({
          currency: order.currency,
          orderDate: order.orderDate ? String(order.orderDate).slice(0, 10) : undefined,
          deliveryDate: order.deliveryDate ? String(order.deliveryDate).slice(0, 10) : undefined,
          actualDeliveryDate: order.actualDeliveryDate ? String(order.actualDeliveryDate).slice(0, 10) : undefined,
          tradeTerms: order.tradeTerms ?? undefined,
          paymentTerms: order.paymentTerms ?? undefined,
          portOfLoading: order.portOfLoading ?? undefined,
          portOfDischarge: order.portOfDischarge ?? undefined,
          cancelReason: order.cancelReason ?? undefined,
          remark: order.remark ?? undefined,
          items: lines.length > 0 ? lines : [{ quantity: 1, unit: ORDER_DEFAULT_UNIT }],
        });

        initialSignature.current = lineSignature(
          lines
            .filter((line): line is LineValue & { productId: string } => Boolean(line.productId))
            .map((line) => ({
              productId: line.productId,
              productName: line.productName,
              productSku: line.productSku ?? null,
              spec: line.spec ?? null,
              craft: line.craft ?? null,
              size: line.size ?? null,
              packaging: line.packaging ?? null,
              quantity: line.quantity ?? 1,
              unit: line.unit ?? ORDER_DEFAULT_UNIT,
              unitPrice: line.unitPrice ?? 0,
              remark: line.remark ?? null,
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
  }, [open, mode, quotationId, salesOrderId, form]);

  /** 表单行 → 提交载荷（productName/SKU 优先取产品当前值，其次保留报价/订单快照） */
  const buildItems = useCallback(
    (values: SalesOrderFormValues): SalesOrderItemInput[] =>
      (values.items ?? [])
        .filter((line): line is LineValue & { productId: string } => Boolean(line?.productId))
        .map((line) => {
          const meta = productMeta.get(line.productId);
          const fallback = itemFallbacks[line.productId];
          return {
            productId: line.productId,
            productName: meta?.name ?? fallback?.name ?? line.productName,
            productSku: meta?.sku ?? fallback?.sku ?? line.productSku ?? null,
            spec: line.spec ?? null,
            craft: line.craft ?? null,
            size: line.size ?? null,
            packaging: line.packaging ?? null,
            quantity: line.quantity ?? 1,
            unit: line.unit ?? ORDER_DEFAULT_UNIT,
            unitPrice: line.unitPrice ?? 0,
            remark: line.remark ?? null,
          };
        }),
    [itemFallbacks, productMeta],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: SalesOrderFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const items = buildItems(values);
    if (items.length === 0) {
      setError('请至少添加一条订单明细');
      return;
    }

    setSubmitting(true);
    try {
      if (isCreate) {
        if (!keys?.opportunityId || !keys.quotationId) throw new Error('缺少来源报价或商机');
        const payload: SalesOrderCreatePayload = {
          opportunityId: keys.opportunityId,
          quotationId: keys.quotationId,
          currency: values.currency ?? 'USD',
          // D-FS4-013：显式 CONFIRMED（后端出运门限排除 DRAFT）
          status: 'CONFIRMED',
          orderDate: values.orderDate ?? null,
          deliveryDate: values.deliveryDate ?? null,
          remark: values.remark?.trim() ? values.remark.trim() : null,
          items,
          // 不提交 customerId / totalAmount / exchangeRate / ownerId
        };
        const saved = await createSalesOrder(payload);
        message.success('创建成功');
        form.resetFields();
        onSaved(saved);
      } else {
        if (!salesOrderId) throw new Error('缺少待编辑的订单 ID');
        const payload: SalesOrderUpdatePayload = {
          remark: values.remark?.trim() ? values.remark.trim() : null,
          orderDate: values.orderDate ?? null,
          deliveryDate: values.deliveryDate ?? null,
          actualDeliveryDate: values.actualDeliveryDate ?? null,
          tradeTerms: values.tradeTerms?.trim() ? values.tradeTerms.trim() : null,
          paymentTerms: values.paymentTerms?.trim() ? values.paymentTerms.trim() : null,
          portOfLoading: values.portOfLoading?.trim() ? values.portOfLoading.trim() : null,
          portOfDischarge: values.portOfDischarge?.trim() ? values.portOfDischarge.trim() : null,
          cancelReason: values.cancelReason?.trim() ? values.cancelReason.trim() : null,
        };
        if (values.currency && values.currency !== initialCurrency.current) payload.currency = values.currency;
        // 硬规则（D-FS4-021）：仅当明细确实变化时才提交 items（后端整表重建，且下游引用会 409）
        if (lineSignature(items) !== initialSignature.current) payload.items = items;
        const saved = await updateSalesOrder(salesOrderId, payload);
        message.success('更新成功');
        onSaved(saved);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, isCreate, keys, salesOrderId, buildItems, message, onSaved]);

  return (
    <Modal
      open={open}
      title={isCreate ? '创建销售订单' : '编辑销售订单'}
      width={980}
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
          title={isCreate ? '创建销售订单失败' : '保存销售订单失败'}
          description={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {isCreate ? <Alert type="info" showIcon title="创建后状态" description={CREATE_STATUS_HINT} style={{ marginBottom: 12 }} /> : null}

      {unusableItems.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`该订单有 ${unusableItems.length} 条明细无法在本表单中保留`}
          description={
            <div>
              <div>{UNAVAILABLE_ITEM_PRODUCT_HINT}</div>
              <div>
                涉及明细：{unusableItems.slice(0, 3).join('、')}
                {unusableItems.length > 3 ? ` 等 ${unusableItems.length} 条` : ''}
              </div>
              <div>{ITEMS_REBUILD_HINT}</div>
              <div>{ITEMS_LOCKED_HINT}</div>
            </div>
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Spin spinning={loadingSource}>
        <Form<SalesOrderFormValues> form={form} layout="vertical">
          <Form.Item label="客户" extra="客户由「报价 → 商机」推导，不可在本表单更换。">
            <Input readOnly value={refs?.customer ?? ''} placeholder="客户" />
          </Form.Item>

          <Form.Item label="商机" extra="创建后不可更换。">
            <Input readOnly value={refs?.opportunity ?? ''} placeholder="商机" />
          </Form.Item>

          <Form.Item label="来源报价" extra="编辑时不可更换；创建入口唯一来自报价详情。">
            <Input readOnly value={refs?.quotation ?? ''} placeholder="来源报价" />
          </Form.Item>

          <Space size={12} wrap style={{ display: 'flex' }}>
            <Form.Item name="currency" label="币种" style={{ width: 200, marginBottom: 12 }}>
              <Select options={ORDER_CURRENCY_OPTIONS} placeholder="币种" />
            </Form.Item>
            <Form.Item name="orderDate" label="订单日期" style={{ width: 180, marginBottom: 12 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="deliveryDate" label="交付日期" style={{ width: 180, marginBottom: 12 }}>
              <Input type="date" />
            </Form.Item>
            {!isCreate ? (
              <Form.Item name="actualDeliveryDate" label="实际交付日期" style={{ width: 180, marginBottom: 12 }}>
                <Input type="date" />
              </Form.Item>
            ) : null}
          </Space>

          <Form.Item label="订单明细" extra={ITEM_VALIDATION_HINT} required>
            <Form.List
              name="items"
              rules={[
                {
                  validator: async (_, value: LineValue[] | undefined) => {
                    if (!value || value.filter((line) => Boolean(line?.productId)).length === 0) {
                      throw new Error('请至少添加一条订单明细');
                    }
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }} wrap>
                      {/* 携带字段：从报价/订单带出的快照，不在 UI 编辑（D-FS4-004） */}
                      <Form.Item name={[field.name, 'productName']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'productSku']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'spec']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'craft']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'size']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'packaging']} hidden>
                        <Input />
                      </Form.Item>
                      <Form.Item name={[field.name, 'unit']} hidden>
                        <Input />
                      </Form.Item>

                      <Form.Item
                        name={[field.name, 'productId']}
                        rules={[{ required: true, message: '请选择产品' }]}
                        style={{ flex: 1, marginBottom: 0, minWidth: 280 }}
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
                            validator: (_r, value: number | undefined) =>
                              typeof value === 'number' && Number.isInteger(value) && value >= 1
                                ? Promise.resolve()
                                : Promise.reject(new Error('数量须为 ≥1 的整数')),
                          },
                        ]}
                        style={{ width: 120, marginBottom: 0 }}
                      >
                        <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="数量" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'unitPrice']}
                        rules={[
                          { required: true, message: '请输入单价' },
                          {
                            validator: (_r, value: number | undefined) =>
                              typeof value === 'number' && value > 0
                                ? Promise.resolve()
                                : Promise.reject(new Error('单价必须大于 0')),
                          },
                        ]}
                        style={{ width: 150, marginBottom: 0 }}
                      >
                        <InputNumber min={0.000001} step={0.01} style={{ width: '100%' }} placeholder="单价" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'remark']} style={{ width: 160, marginBottom: 0 }}>
                        <Input placeholder="行备注" maxLength={200} />
                      </Form.Item>
                      <Button type="text" danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Space size={8}>
                    <Button onClick={() => add({ quantity: 1, unit: ORDER_DEFAULT_UNIT })}>添加明细</Button>
                    {isCreate && !loadingSource && sourceItemCount === 0 ? (
                      <Text type="secondary">该报价没有可带入的产品明细，请手动添加。</Text>
                    ) : null}
                  </Space>
                  <Form.ErrorList errors={errors} />
                </Space>
              )}
            </Form.List>
          </Form.Item>

          {!isCreate ? (
            <Space size={12} wrap style={{ display: 'flex' }}>
              <Form.Item name="tradeTerms" label="贸易条款" style={{ width: 220, marginBottom: 12 }}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="paymentTerms" label="付款条款" style={{ width: 220, marginBottom: 12 }}>
                <Input maxLength={200} />
              </Form.Item>
              <Form.Item name="portOfLoading" label="装运港" style={{ width: 180, marginBottom: 12 }}>
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="portOfDischarge" label="目的港" style={{ width: 180, marginBottom: 12 }}>
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="cancelReason" label="取消原因" style={{ width: 240, marginBottom: 12 }}>
                <Input maxLength={200} />
              </Form.Item>
            </Space>
          ) : null}

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
