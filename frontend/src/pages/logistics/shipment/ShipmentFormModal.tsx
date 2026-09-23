import { Alert, App, Form, Input, InputNumber, Modal, Space, Spin, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSalesOrder } from '../../../api/salesOrders';
import { createShipment } from '../../../api/shipments';
import { getErrorMessage } from '../../../api/request';
import type { SalesOrderDetail, SalesOrderItem } from '../../../types/salesOrder';
import type { ShipmentItemInput, ShipmentListItem } from '../../../types/shipment';
import { formatDecimalString, textOrDash } from '../../../utils/format';
import { QUANTITY_SAFETY_HINT, SHIPMENT_ITEM_LINEAGE_HINT, SHIPPABLE_STATUS_HINT, SHIPMENT_STATUS_HINT } from './constants';

const { Text } = Typography;

interface LineValue {
  salesOrderItemId?: string;
  quantity?: number;
  packageCount?: number;
  grossWeight?: number;
  volume?: number;
}

interface ShipmentFormValues {
  shipmentDate?: string;
  etd?: string;
  eta?: string;
  carrier?: string;
  vessel?: string;
  trackingNo?: string;
  notes?: string;
  items?: LineValue[];
}

export interface ShipmentFormModalProps {
  open: boolean;
  /** 目标销售订单（**唯一创建入口** = 订单详情「创建出运单」） */
  salesOrderId?: string;
  onCancel: () => void;
  onSaved: (shipment: ShipmentListItem) => void;
}

/** Decimal-string → number（表单层解析；用于「可出运数量」比较） */
const toNumber = (raw: string | null | undefined): number => {
  const n = Number(raw ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * 出运单创建表单（Round F-S5）
 *
 * 契约（shipment.controller createSchema L88-115）：
 *   提交：salesOrderId · items[{salesOrderItemId, quantity, packageCount?, grossWeight?, volume?}] · 物流/日期可选字段
 *   不提交：customerId（后端由订单推导）· status（后端默认 DRAFT）
 * 硬规则（后端）：
 *   · 订单状态必须 ∈ SHIPPABLE_STATUSES（DRAFT/COMPLETED/CANCELLED ⇒ 400）；
 *   · 每行 quantity > 0 且 ≤ 订单行 quantity − 已出运数量（超出 ⇒ 409）；
 *   · 创建成功由后端在**同一事务**内重算 shippedQty（前端不计算、不回写）。
 */
export default function ShipmentFormModal({ open, salesOrderId, onCancel, onSaved }: ShipmentFormModalProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ShipmentFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<SalesOrderDetail | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setOrder(null);
    form.resetFields();

    if (!salesOrderId) {
      setError('缺少目标销售订单 ID');
      return;
    }

    let cancelled = false;
    setLoadingSource(true);
    void getSalesOrder(salesOrderId)
      .then((detail) => {
        if (cancelled) return;
        setOrder(detail);
        form.setFieldsValue({
          items: detail.items.map((item) => ({ salesOrderItemId: item.id })),
        });
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
  }, [open, salesOrderId, form]);

  /** 订单行 → 剩余可出运数量 */
  const remainingOf = useCallback(
    (item: SalesOrderItem): number => toNumber(item.quantity) - toNumber(item.shippedQty),
    [],
  );

  const remainingById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of order?.items ?? []) map.set(item.id, remainingOf(item));
    return map;
  }, [order, remainingOf]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    let values: ShipmentFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const items: ShipmentItemInput[] = (values.items ?? [])
      .filter((line) => Boolean(line?.salesOrderItemId) && typeof line?.quantity === 'number' && line.quantity > 0)
      .map((line) => ({
        salesOrderItemId: line.salesOrderItemId as string,
        quantity: line.quantity as number,
        packageCount: line.packageCount ?? null,
        grossWeight: line.grossWeight ?? null,
        volume: line.volume ?? null,
      }));

    if (items.length === 0) {
      setError('请至少为一条订单行填写本次出运数量');
      return;
    }

    setSubmitting(true);
    try {
      if (!salesOrderId) throw new Error('缺少目标销售订单 ID');
      const saved = await createShipment({
        salesOrderId,
        shipmentDate: values.shipmentDate ?? null,
        etd: values.etd ?? null,
        eta: values.eta ?? null,
        carrier: values.carrier?.trim() ? values.carrier.trim() : null,
        vessel: values.vessel?.trim() ? values.vessel.trim() : null,
        trackingNo: values.trackingNo?.trim() ? values.trackingNo.trim() : null,
        notes: values.notes?.trim() ? values.notes.trim() : null,
        items,
      });
      message.success('创建成功');
      form.resetFields();
      onSaved(saved);
    } catch (err) {
      // 后端 409（超出可出运数量）/ 400（订单状态不允许）等错误必须完整展示，不吞掉
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }, [form, salesOrderId, message, onSaved]);

  return (
    <Modal
      open={open}
      title="创建出运单"
      width={980}
      okText="创建"
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
        <Alert type="error" showIcon title="创建出运单失败" description={error} style={{ marginBottom: 12 }} />
      ) : null}

      <Alert type="info" showIcon title="出运规则" description={`${SHIPMENT_STATUS_HINT}${SHIPPABLE_STATUS_HINT}`} style={{ marginBottom: 12 }} />

      <Spin spinning={loadingSource}>
        <Form<ShipmentFormValues> form={form} layout="vertical">
          <Space size={12} wrap style={{ display: 'flex' }}>
            <Form.Item label="销售订单" style={{ minWidth: 240, marginBottom: 12 }}>
              <Input readOnly value={order ? `${order.orderNo}（${order.status}）` : ''} />
            </Form.Item>
            <Form.Item label="客户" style={{ minWidth: 200, marginBottom: 12 }}>
              <Input readOnly value={order?.customer.companyName ?? ''} />
            </Form.Item>
          </Space>

          <div style={{ marginBottom: 8 }}>
            <Text strong>订单明细（填写本次出运数量）</Text>
            <div>
              <Text type="secondary">
                {QUANTITY_SAFETY_HINT} {SHIPMENT_ITEM_LINEAGE_HINT}
              </Text>
            </div>
          </div>

          <Form.List
            name="items"
            rules={[
              {
                validator: async (_, value: LineValue[] | undefined) => {
                  const filled = (value ?? []).filter((line) => typeof line?.quantity === 'number' && line.quantity > 0);
                  if (filled.length === 0) throw new Error('请至少为一条订单行填写本次出运数量');
                },
              },
            ]}
          >
            {(fields, _ops, { errors }) => (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                {fields.map((field) => {
                  const lineNo = (form.getFieldValue(['items', field.name, 'salesOrderItemId']) as string) ?? '';
                  const orderItem = order?.items.find((item) => item.id === lineNo);
                  const remaining = remainingById.get(lineNo) ?? 0;
                  return (
                    <Space key={field.key} align="baseline" wrap style={{ display: 'flex' }}>
                      <Form.Item name={[field.name, 'salesOrderItemId']} hidden>
                        <Input />
                      </Form.Item>
                      <Text style={{ width: 260 }}>
                        第 {orderItem?.lineNo ?? '-'} 行 · {textOrDash(orderItem?.product?.name ?? orderItem?.productName)}
                      </Text>
                      <Text type="secondary" style={{ width: 120 }}>
                        可出运 {formatDecimalString(String(remaining))}
                      </Text>
                      <Form.Item
                        name={[field.name, 'quantity']}
                        rules={[
                          {
                            validator: (_r, value: number | undefined) => {
                              if (value === undefined || value === null) return Promise.resolve(); // 未填写 = 不出运该行
                              if (value <= 0) return Promise.reject(new Error('数量须大于 0'));
                              if (value > remaining) return Promise.reject(new Error(`不得超过可出运数量 ${remaining}`));
                              return Promise.resolve();
                            },
                          },
                        ]}
                        style={{ width: 140, marginBottom: 0 }}
                      >
                        <InputNumber min={0} step={1} style={{ width: '100%' }} placeholder="本次数量" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'packageCount']} style={{ width: 110, marginBottom: 0 }}>
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="件数" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'grossWeight']} style={{ width: 120, marginBottom: 0 }}>
                        <InputNumber min={0} style={{ width: '100%' }} placeholder="毛重" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'volume']} style={{ width: 110, marginBottom: 0 }}>
                        <InputNumber min={0} style={{ width: '100%' }} placeholder="体积" />
                      </Form.Item>
                    </Space>
                  );
                })}
                <Form.ErrorList errors={errors} />
              </Space>
            )}
          </Form.List>

          <Space size={12} wrap style={{ display: 'flex', marginTop: 12 }}>
            <Form.Item name="shipmentDate" label="出运日期" style={{ width: 170, marginBottom: 12 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="etd" label="ETD" style={{ width: 170, marginBottom: 12 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="eta" label="ETA" style={{ width: 170, marginBottom: 12 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="carrier" label="承运人" style={{ width: 180, marginBottom: 12 }}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="vessel" label="船名/航班" style={{ width: 180, marginBottom: 12 }}>
              <Input maxLength={100} />
            </Form.Item>
            <Form.Item name="trackingNo" label="跟踪号" style={{ width: 180, marginBottom: 12 }}>
              <Input maxLength={100} />
            </Form.Item>
          </Space>

          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Spin>
    </Modal>
  );
}
