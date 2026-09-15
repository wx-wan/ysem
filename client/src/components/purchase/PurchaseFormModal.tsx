import React from 'react';
import {
  Modal, Form, Input, Select, InputNumber, Space, Button, App, Row, Col, Divider, Tooltip,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import {
  purchaseApi,
  PURCHASE_TYPE_TEXT,
  type PurchaseOrder,
  type PurchaseOrderItemInput,
  type PurchaseType,
  type Supplier,
} from '../../api/purchases';
import { salesOrderApi } from '../../api/salesOrders';
import { Z_INDEX } from '../../zIndex';
import { productApi } from '../../api/products';

/**
 * V1.0 采购单 新建 / 编辑弹窗
 *
 * 关键契约（V1.0 PurchaseOrder）：
 *  - 明细为 `PurchaseOrderItem[]`（**不再有 JSON 明细**）；
 *  - **不提交任何金额**（amount / totalAmount / totalAmountCny 均由服务端权威计算）；
 *  - **不提交 arrivedQty / status**：后端按 `lineNo`（= 数组位置 + 1）保留既有行级到货状态，
 *    故编辑时保持行顺序、不随机重排 `lineNo`；
 *  - 新增行排在末尾（保证既有行位置稳定）。
 */

interface Props {
  open: boolean;
  editing: PurchaseOrder | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface SupplierForm {
  name: string;
  contact?: string;
  phone?: string;
}

interface ItemFormRow {
  lineNo: number;
  productId?: string | null;
  itemName?: string;
  spec?: string | null;
  quantity?: number | string;
  unit?: string;
  unitPrice?: number | string;
  remark?: string | null;
}

const CURRENCY_OPTIONS = ['CNY', 'USD', 'EUR', 'GBP', 'JPY', 'HKD'].map((v) => ({ label: v, value: v }));

const toNum = (v?: string | number | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const PurchaseFormModal: React.FC<Props> = React.memo(({ open, editing, onClose, onSuccess }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);

  // 供应商
  const [suppliers, setSuppliers] = React.useState<Supplier[]>([]);
  const [supplierKeyword, setSupplierKeyword] = React.useState('');
  const [supplierModal, setSupplierModal] = React.useState(false);
  const [supplierForm] = Form.useForm();
  const [creatingSupplier, setCreatingSupplier] = React.useState(false);

  // 产品搜索
  const [productOptions, setProductOptions] = React.useState<
    { id: string; name: string; sku?: string | null; sizeL?: string | null; sizeW?: string | null }[]
  >([]);

  // 来源销售订单（V1.0 SalesOrder；ADR-14 成本归集需要）
  const [salesOrderOptions, setSalesOrderOptions] = React.useState<{ label: string; value: string }[]>([]);

  const loadSuppliers = React.useCallback(async (keyword = '') => {
    try {
      const res = await purchaseApi.listSuppliers({ keyword: keyword || undefined });
      setSuppliers(res.data?.data?.items || []);
    } catch {
      setSuppliers([]);
    }
  }, []);

  const searchProducts = React.useCallback(async (keyword = '') => {
    try {
      const res = await productApi.getList({ keyword: keyword || undefined, page: 1, pageSize: 10 });
      setProductOptions(res.data?.data?.list || []);
    } catch {
      setProductOptions([]);
    }
  }, []);

  const loadSalesOrders = React.useCallback(async () => {
    try {
      const res = await salesOrderApi.list({ pageSize: 100 });
      setSalesOrderOptions(
        (res.data?.data?.list || []).map((o) => ({
          label: `${o.orderNo}${o.customer?.companyName ? ` · ${o.customer.companyName}` : ''}`,
          value: o.id,
        })),
      );
    } catch {
      setSalesOrderOptions([]);
    }
  }, []);

  /** 下一可用行号（保持既有行 lineNo 稳定，新增行排末尾） */
  const nextLineNo = (rows: ItemFormRow[]): number =>
    rows.reduce((m, r) => Math.max(m, Number(r?.lineNo) || 0), 0) + 1;

  React.useEffect(() => {
    if (!open) return;
    loadSuppliers();
    searchProducts();
    loadSalesOrders();
    if (editing) {
      const rows: ItemFormRow[] = (editing.items || []).map((it) => ({
        lineNo: it.lineNo,
        productId: it.productId || undefined,
        itemName: it.itemName,
        spec: it.spec || '',
        quantity: toNum(it.quantity) ?? undefined,
        unit: it.unit || 'PCS',
        unitPrice: toNum(it.unitPrice) ?? undefined,
        remark: it.remark || '',
      }));
      form.setFieldsValue({
        supplierId: editing.supplierId || undefined,
        salesOrderId: editing.salesOrderId || undefined,
        productionOrderId: editing.productionOrderId || undefined,
        purchaseType: editing.purchaseType || 'MATERIAL',
        purchaseDate: editing.purchaseDate ? String(editing.purchaseDate).slice(0, 10) : undefined,
        expectedArrivalAt: editing.expectedArrivalAt ? String(editing.expectedArrivalAt).slice(0, 10) : undefined,
        currency: editing.currency || 'CNY',
        exchangeRate: toNum(editing.exchangeRate) ?? undefined,
        remark: editing.remark || '',
        items: rows.length ? rows : [{ lineNo: 1, itemName: '', quantity: 1, unit: 'PCS', unitPrice: 0 }],
      });
    } else {
      form.resetFields();
      form.setFieldsValue({
        purchaseType: 'MATERIAL',
        currency: 'CNY',
        items: [{ lineNo: 1, itemName: '', quantity: 1, unit: 'PCS', unitPrice: 0 }],
      });
    }
  }, [open, editing, form, loadSuppliers, searchProducts, loadSalesOrders]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const rawRows: ItemFormRow[] = values.items || [];

      // 按 lineNo 升序提交 → 与后端「lineNo = 数组位置 + 1」对齐，最大限度保留既有行级状态
      const sorted = [...rawRows].sort((a, b) => (Number(a.lineNo) || 0) - (Number(b.lineNo) || 0));
      const items: PurchaseOrderItemInput[] = sorted.map((it) => ({
        productId: it.productId || null,
        itemName: (it.itemName || '').trim(),
        spec: it.spec || null,
        quantity: Number(it.quantity) || 0,
        unit: it.unit || 'PCS',
        unitPrice: Number(it.unitPrice) || 0,
        remark: it.remark || null,
        // 不提交 amount / arrivedQty / status：金额由服务端计算，行级到货状态由后端按行保留
      }));

      if (!items.length || items.some((it) => !it.itemName)) {
        message.warning('请完整填写采购明细（产品名称必填）');
        return;
      }
      if (items.some((it) => Number(it.quantity) <= 0)) {
        message.warning('明细数量必须大于 0');
        return;
      }

      setSaving(true);
      const payload = {
        supplierId: values.supplierId || null,
        salesOrderId: values.salesOrderId || null,
        productionOrderId: values.productionOrderId || null,
        purchaseType: values.purchaseType as PurchaseType,
        purchaseDate: values.purchaseDate || null,
        expectedArrivalAt: values.expectedArrivalAt || null,
        currency: values.currency,
        exchangeRate: values.exchangeRate != null ? Number(values.exchangeRate) : null,
        remark: values.remark || null,
        items,
      };

      if (editing) {
        await purchaseApi.update(editing.id, payload);
        message.success('更新成功');
      } else {
        await purchaseApi.create(payload);
        message.success('创建成功');
      }
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e?.response?.data?.message || e?.message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateSupplier = async () => {
    try {
      const v = await supplierForm.validateFields();
      setCreatingSupplier(true);
      const res = await purchaseApi.createSupplier(v);
      message.success('供应商创建成功');
      setSupplierModal(false);
      supplierForm.resetFields();
      await loadSuppliers('');
      const created = res.data?.data?.item;
      if (created) form.setFieldValue('supplierId', created.id);
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e?.response?.data?.message || e?.message || '创建失败');
    } finally {
      setCreatingSupplier(false);
    }
  };

  /** 明细行（响应式，用于行金额预览） */
  const watchedItems: ItemFormRow[] = Form.useWatch('items', form) || [];
  const previewTotal = watchedItems.reduce(
    (sum, it) => sum + (Number(it?.quantity) || 0) * (Number(it?.unitPrice) || 0),
    0,
  );
  const currency = Form.useWatch('currency', form) || 'CNY';

  return (
    <>
      <Modal
        title={editing ? `编辑采购单${editing.purchaseNo ? ` · ${editing.purchaseNo}` : ''}` : '新建采购单'}
        open={open}
        onOk={handleSave}
        onCancel={onClose}
        confirmLoading={saving}
        width={1080}
        zIndex={Z_INDEX.overlay}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="supplierId" label="供应商">
                <Select
                  placeholder="搜索并选择供应商"
                  showSearch
                  allowClear
                  filterOption={false}
                  onSearch={(v) => {
                    setSupplierKeyword(v);
                    loadSuppliers(v);
                  }}
                  notFoundContent={
                    <div style={{ textAlign: 'center', padding: 8 }}>
                      <Button type="link" size="small" icon={<PlusOutlined />} onClick={() => setSupplierModal(true)}>
                        新增供应商「{supplierKeyword}」
                      </Button>
                    </div>
                  }
                  options={suppliers.map((s) => ({
                    value: s.id,
                    label: `${s.name}${s.contact ? `（${s.contact}${s.phone ? ' / ' + s.phone : ''}）` : ''}`,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="purchaseType" label="采购类型" rules={[{ required: true, message: '请选择采购类型' }]}>
                <Select
                  options={(Object.keys(PURCHASE_TYPE_TEXT) as PurchaseType[]).map((k) => ({
                    label: PURCHASE_TYPE_TEXT[k],
                    value: k,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col span={5}>
              <Form.Item name="purchaseDate" label="采购日期">
                <Input type="date" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="expectedArrivalAt" label="预计到货">
                <Input type="date" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="salesOrderId" label="来源销售订单（可选）">
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择销售订单（成本归集）"
                  options={salesOrderOptions}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="productionOrderId"
                label="生产工单 ID（可选）"
                tooltip="当前无生产工单下拉数据源，如需归集到生产工单请填写其 ID；留空表示不关联"
              >
                <Input placeholder="生产工单 ID（留空则不关联）" allowClear />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item name="currency" label="币种">
                <Select options={CURRENCY_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={4}>
              <Form.Item
                name="exchangeRate"
                label="汇率"
                tooltip="rateToCny：1 单位原币 = X CNY；CNY 恒为 1，留空则由服务端取最近一期汇率"
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={6} disabled={currency === 'CNY'} />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '4px 0 12px', borderTop: '1px dashed rgba(5,5,5,0.06)' }} />

          <Form.Item label="采购明细" required style={{ marginBottom: 4 }}>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                      <Form.Item {...restField} name={[name, 'lineNo']} hidden>
                        <InputNumber />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'productId']} style={{ width: 230, marginBottom: 0 }}>
                        <Select
                          placeholder="搜索选择产品（可选）"
                          showSearch
                          allowClear
                          filterOption={false}
                          onSearch={(v) => searchProducts(v)}
                          onChange={(val) => {
                            const p = productOptions.find((o) => o.id === val);
                            if (p) {
                              const rows: ItemFormRow[] = form.getFieldValue('items') || [];
                              form.setFieldsValue({
                                items: rows.map((it, i) =>
                                  i === name
                                    ? {
                                        ...it,
                                        itemName: p.name,
                                        spec: [p.sizeL, p.sizeW].filter(Boolean).join('x') || '',
                                      }
                                    : it,
                                ),
                              });
                            }
                          }}
                          options={productOptions.map((p) => ({
                            value: p.id,
                            label: `${p.name}${p.sku ? `（${p.sku}）` : ''}`,
                          }))}
                        />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'itemName']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 190, marginBottom: 0 }}
                      >
                        <Input placeholder="产品名称（快照）" />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'spec']} style={{ width: 110, marginBottom: 0 }}>
                        <Input placeholder="规格" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'quantity']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 100, marginBottom: 0 }}
                      >
                        <InputNumber min={0} placeholder="数量" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item {...restField} name={[name, 'unit']} style={{ width: 80, marginBottom: 0 }}>
                        <Input placeholder="单位" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'unitPrice']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 120, marginBottom: 0 }}
                      >
                        <InputNumber min={0} precision={2} placeholder="单价" style={{ width: '100%' }} />
                      </Form.Item>
                      <Tooltip title="金额由服务端按 数量 × 单价 计算，此处仅为预览">
                        <span style={{ width: 110, textAlign: 'right', color: '#595959', fontSize: 13 }}>
                          {currency} {(
                            (Number(watchedItems[name]?.quantity) || 0) *
                            (Number(watchedItems[name]?.unitPrice) || 0)
                          ).toFixed(2)}
                        </span>
                      </Tooltip>
                      {editing && editing.items?.[name] && (
                        <Tooltip title="行级到货状态由后端按行保留，本轮不在表单中修改">
                          <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                            已到 {toNum(editing.items[name].arrivedQty) ?? 0}
                          </span>
                        </Tooltip>
                      )}
                      <MinusCircleOutlined
                        onClick={() => {
                          const rows: ItemFormRow[] = form.getFieldValue('items') || [];
                          remove(name);
                          // 删除后为其余行重排行号（保持从 1 连续），避免与后端位置语义错位
                          const rest = rows.filter((_, i) => i !== name);
                          form.setFieldsValue({
                            items: rest.map((it, i) => ({ ...it, lineNo: i + 1 })),
                          });
                        }}
                        style={{ color: '#ff4d4f' }}
                      />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const rows: ItemFormRow[] = form.getFieldValue('items') || [];
                      add({
                        lineNo: nextLineNo(rows),
                        itemName: '',
                        quantity: 1,
                        unit: 'PCS',
                        unitPrice: 0,
                      });
                    }}
                    style={{ marginTop: 4 }}
                  >
                    添加明细
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>

          <Row justify="end" style={{ margin: '12px 0 0' }}>
            <Col>
              <Space>
                <span style={{ color: '#8c8c8c' }}>合计金额（预览）</span>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#1677ff' }}>
                  {currency} {previewTotal.toFixed(2)}
                </span>
              </Space>
            </Col>
          </Row>
          <div style={{ marginTop: 4, fontSize: 12, color: '#8c8c8c', textAlign: 'right' }}>
            金额与折合 CNY 由服务端权威计算，保存后以服务端结果为准
          </div>

          <Form.Item name="remark" label="备注" style={{ marginTop: 8, marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 快捷新增供应商（仍走 /api/purchases/suppliers） */}
      <Modal
        title="新增供应商"
        open={supplierModal}
        onOk={handleCreateSupplier}
        onCancel={() => setSupplierModal(false)}
        confirmLoading={creatingSupplier}
        width={420}
        zIndex={Z_INDEX.overlayNested}
        forceRender
      >
        <Form form={supplierForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="供应商名称" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="contact" label="联系人">
                <Input placeholder="联系人" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
});

export default PurchaseFormModal;
