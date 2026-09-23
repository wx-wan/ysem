import { Alert, App, Button, Form, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOpportunity, getOpportunity, updateOpportunity } from '../../../api/sales';
import { getErrorMessage } from '../../../api/request';
import ProductSelect from '../../products/ProductSelect';
import type { IntentLevel, OpportunityCreatePayload, OpportunityListItem, OpportunityUpdatePayload } from '../../../types/sales';
import CustomerSelect from './CustomerSelect';
import {
  CUSTOMER_IMMUTABLE_HINT,
  INTENT_CLEAR_UNSUPPORTED_HINT,
  ITEMS_REBUILD_HINT,
  OPPORTUNITY_INTENT_OPTIONS,
} from './constants';

const { Text } = Typography;

export type OpportunityFormMode = 'create' | 'edit';

interface ProductLineValue {
  productId?: string;
  quantity?: number;
}

interface OpportunityFormValues {
  customerId?: string;
  title: string;
  products?: ProductLineValue[];
  intentLevel?: IntentLevel;
  estimatedAmount?: number | null;
  estimatedCloseDate?: string;
  notes?: string;
}

export interface OpportunityFormModalProps {
  mode: OpportunityFormMode;
  open: boolean;
  /** create：预置客户（来自客户详情入口）—— 预置后客户不可更换；companyName 可缺省（选项载入后自动校正显示） */
  presetCustomer?: { id: string; companyName?: string | null; customerNo?: string | null } | null;
  /** edit：目标商机 id（打开时 GET /api/sales/:id 拉取真实数据回填） */
  opportunityId?: string;
  onCancel: () => void;
  onSaved: (opportunity: OpportunityListItem) => void;
}

/** Decimal-string（'1200.0000'）→ InputNumber 可承载的 number；非法/空 → null */
const decimalToNumber = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

/** 明细行的可比较签名（用于判断用户是否改动了产品明细） */
const lineSignature = (lines: ProductLineValue[]): string =>
  JSON.stringify(
    lines.map((line) => ({ productId: line.productId ?? null, quantity: line.quantity ?? null })),
  );

/**
 * Opportunity Create / Edit 表单（Round F-S2）
 *
 * 契约边界（**严格等于** createOpportunitySchema 白名单，见 types/sales.ts）：
 *   可写：customerId（仅 Create）· title · estimatedAmount · estimatedCloseDate · intentLevel · notes · products[]
 *   不写：probability（旧版兼容字段，双语义）· ownerId（F-01 owner 候选源缺失 ⇒ 指派 BLOCKED）· leadId（Lead 不在本轮范围）
 *   派生：stage 由后端推导，**不提供人工入口**
 *
 * 关键语义（均来自后端源码，不臆测）：
 *   · 传 `products` ⇒ 后端**重建**明细（deleteMany + create）⇒ 仅在用户实际改动明细时才提交该字段，
 *     避免无损覆盖 targetPrice / spec / remark 等本表单不承载的字段（后端 L468-486）；
 *   · `intentLevel` 传 null **不会清空**（后端 L484-489）⇒ 编辑态不提供「清空意向」；
 *   · 更换客户在后端 schema 中虽可行，但本阶段 UI **不提供**（保 MVP 与派生口径稳定）。
 */
export default function OpportunityFormModal({
  mode,
  open,
  presetCustomer,
  opportunityId,
  onCancel,
  onSaved,
}: OpportunityFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<OpportunityFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 编辑态：真实客户（只读展示，不可更换） */
  const [editCustomer, setEditCustomer] = useState<{ id: string; companyName: string } | null>(null);
  /** 编辑态：无关联产品的历史明细条数（保存后不再保留，需提前告知） */
  const [detachedItemCount, setDetachedItemCount] = useState(0);
  /** 编辑态：产品行 → 兜底选项（产品不可见 / 已删除时仍能正确显示） */
  const [itemFallbacks, setItemFallbacks] = useState<Record<string, { id: string; name: string; sku?: string | null }>>({});
  /** 打开时的明细签名（用于判断是否需要提交 products） */
  const initialSignature = useRef<string>('');

  const isCreate = mode === 'create';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setEditCustomer(null);
    setDetachedItemCount(0);
    setItemFallbacks({});
    form.resetFields();

    if (mode === 'create') {
      form.setFieldsValue({
        customerId: presetCustomer?.id,
        products: [{ quantity: 1 }],
      });
      initialSignature.current = lineSignature([{ quantity: 1 }]);
      return;
    }

    if (!opportunityId) {
      setError('缺少待编辑的商机 ID');
      return;
    }

    let cancelled = false;
    setLoadingDetail(true);
    void getOpportunity(opportunityId)
      .then((detail) => {
        if (cancelled) return;
        setEditCustomer({ id: detail.customer.id, companyName: detail.customer.companyName });

        const fallbacks: Record<string, { id: string; name: string; sku?: string | null }> = {};
        const lines: ProductLineValue[] = [];
        let detached = 0;
        for (const item of detail.items) {
          if (!item.productId) {
            detached += 1;
            continue;
          }
          const name = item.product?.name ?? item.productName ?? '（产品不可见）';
          fallbacks[item.productId] = { id: item.productId, name, sku: item.product?.sku ?? null };
          lines.push({ productId: item.productId, quantity: item.quantity });
        }
        setItemFallbacks(fallbacks);
        setDetachedItemCount(detached);

        form.setFieldsValue({
          title: detail.title,
          products: lines.length > 0 ? lines : [{ quantity: 1 }],
          intentLevel: detail.intentLevel ?? undefined,
          estimatedAmount: decimalToNumber(detail.estimatedAmount),
          estimatedCloseDate: detail.estimatedCloseDate ? String(detail.estimatedCloseDate).slice(0, 10) : undefined,
          notes: detail.notes ?? undefined,
        });
        initialSignature.current = lineSignature(lines);
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
  }, [open, mode, opportunityId, presetCustomer, form]);

  const buildLines = useCallback(
    (values: OpportunityFormValues): OpportunityCreatePayload['products'] =>
      (values.products ?? [])
        .filter((line): line is ProductLineValue & { productId: string } => Boolean(line?.productId))
        .map((line) => ({ productId: line.productId, quantity: line.quantity ?? 1 })),
    [],
  );

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: OpportunityFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 表单校验失败（title / customerId / 明细行）
    }

    const products = buildLines(values);
    const notes = values.notes?.trim() ? values.notes.trim() : null;

    setSubmitting(true);
    try {
      if (isCreate) {
        const customerId = values.customerId ?? presetCustomer?.id;
        if (!customerId) throw new Error('请选择客户');
        const payload: OpportunityCreatePayload = {
          customerId,
          title: values.title.trim(),
          products,
          estimatedAmount: values.estimatedAmount ?? null,
          estimatedCloseDate: values.estimatedCloseDate ?? null,
          notes,
          // intentLevel 可选：未选择时不提交（后端默认 null）；不发送 probability / ownerId / leadId
          ...(values.intentLevel ? { intentLevel: values.intentLevel } : {}),
        };
        const saved = await createOpportunity(payload);
        message.success('创建成功');
        form.resetFields();
        onSaved(saved);
      } else {
        if (!opportunityId) throw new Error('缺少待编辑的商机 ID');
        const payload: OpportunityUpdatePayload = {
          title: values.title.trim(),
          estimatedAmount: values.estimatedAmount ?? null,
          estimatedCloseDate: values.estimatedCloseDate ?? null,
          notes,
        };
        // 意向：仅在选择时提交（后端不支持清空为 null）
        if (values.intentLevel) payload.intentLevel = values.intentLevel;
        // 明细：仅在用户实际改动时提交（后端会整体重建明细）
        if (lineSignature(values.products ?? []) !== initialSignature.current) {
          payload.products = products;
        }
        const saved = await updateOpportunity(opportunityId, payload);
        message.success('更新成功');
        onSaved(saved);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, isCreate, opportunityId, presetCustomer, buildLines, message, onSaved]);

  const lockedCustomer = isCreate ? presetCustomer ?? null : editCustomer;
  const customerLocked = Boolean(isCreate && presetCustomer);

  const fallbackOptions = useMemo(() => itemFallbacks, [itemFallbacks]);

  return (
    <Modal
      open={open}
      title={isCreate ? '新建商机' : '编辑商机'}
      width={760}
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
          title={isCreate ? '创建商机失败' : '保存商机失败'}
          description={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      {!isCreate && detachedItemCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          title={`该商机有 ${detachedItemCount} 条明细未关联产品（productId 为空）`}
          description="此类明细无法在本表单中表示；一旦保存产品明细，它们将不再保留（后端以提交内容整体重建明细）。"
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Spin spinning={loadingDetail}>
        <Form<OpportunityFormValues> form={form} layout="vertical">
          <Form.Item
            name="customerId"
            label="客户"
            rules={isCreate ? [{ required: true, message: '请选择客户' }] : undefined}
            extra={customerLocked ? '由客户详情带入，创建时不可更换。' : !isCreate ? CUSTOMER_IMMUTABLE_HINT : undefined}
          >
            <CustomerSelect
              disabled={!isCreate || customerLocked}
              placeholder={lockedCustomer?.companyName ?? '选择客户'}
              fallbackOption={
                lockedCustomer
                  ? { id: lockedCustomer.id, companyName: lockedCustomer.companyName }
                  : null
              }
            />
          </Form.Item>

          <Form.Item name="title" label="商机名称" rules={[{ required: true, message: '请输入商机名称' }]}>
            <Input maxLength={200} placeholder="例如：2026 春季新款报价" />
          </Form.Item>

          <Form.Item label="产品明细" extra={ITEMS_REBUILD_HINT} required>
            <Form.List
              name="products"
              rules={[
                {
                  validator: async (_, value: ProductLineValue[] | undefined) => {
                    if (!value || value.length === 0) throw new Error('请至少添加一个产品');
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex' }}>
                      <Form.Item
                        name={[field.name, 'productId']}
                        rules={[{ required: true, message: '请选择产品' }]}
                        style={{ flex: 1, marginBottom: 0, minWidth: 320 }}
                      >
                        <ProductSelect
                          placeholder="选择产品"
                          allowClear={false}
                          fallbackOption={
                            form.getFieldValue(['products', field.name, 'productId'])
                              ? fallbackOptions[form.getFieldValue(['products', field.name, 'productId']) as string] ?? null
                              : null
                          }
                        />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'quantity']}
                        rules={[{ required: true, message: '请输入数量' }]}
                        style={{ width: 140, marginBottom: 0 }}
                      >
                        <InputNumber min={1} precision={0} style={{ width: '100%' }} placeholder="数量" />
                      </Form.Item>
                      <Button type="text" danger disabled={fields.length <= 1} onClick={() => remove(field.name)}>
                        删除
                      </Button>
                    </Space>
                  ))}
                  <Space size={8}>
                    <Button onClick={() => add({ quantity: 1 })}>添加产品</Button>
                    <Text type="secondary">数量为整数（≥1），对应后端 products[].quantity。</Text>
                  </Space>
                  <Form.ErrorList errors={errors} />
                </Space>
              )}
            </Form.List>
          </Form.Item>

          <Form.Item
            name="intentLevel"
            label="商机意向"
            extra={isCreate ? '可选；不选择则不设置。' : INTENT_CLEAR_UNSUPPORTED_HINT}
          >
            <Select
              allowClear={isCreate}
              options={OPPORTUNITY_INTENT_OPTIONS}
              placeholder="商机意向"
            />
          </Form.Item>

          <Form.Item name="estimatedAmount" label="预计金额">
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="预计金额（可选）" />
          </Form.Item>

          <Form.Item name="estimatedCloseDate" label="预计成交日期">
            <Input type="date" />
          </Form.Item>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
