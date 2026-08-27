import React from 'react';
import {
  Modal, Form, Input, Select, InputNumber, Space, Button, App, Row, Col, Divider,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { purchaseApi, PurchaseOrder, PurchaseItem, Supplier } from '../../api/purchases';
import { Z_INDEX } from '../../zIndex';
import { productApi } from '../../api/products';

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
  const [productOptions, setProductOptions] = React.useState<{ id: string; name: string; sku?: string | null; sizeL?: string | null; sizeW?: string | null }[]>([]);

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

  React.useEffect(() => {
    if (open) {
      loadSuppliers();
      searchProducts();
      if (editing) {
        let items: PurchaseItem[] = [];
        try {
          items = editing.items ? (JSON.parse(editing.items) as PurchaseItem[]) : [];
        } catch {
          items = [];
        }
        form.setFieldsValue({
          supplierId: editing.supplierId,
          purchaseDate: editing.purchaseDate,
          remark: editing.remark,
          items: items.length ? items : [{ name: '', quantity: 1, unitPrice: 0 }],
        });
      } else {
        form.resetFields();
        form.setFieldsValue({ items: [{ name: '', quantity: 1, unitPrice: 0 }] });
      }
    }
  }, [open, editing, form, loadSuppliers, searchProducts]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const items = (values.items || []).map((it: PurchaseItem) => ({
        productId: it.productId || null,
        name: (it.name || '').trim(),
        spec: it.spec || null,
        quantity: it.quantity || 0,
        unitPrice: it.unitPrice || 0,
        amount: (it.quantity || 0) * (it.unitPrice || 0),
      }));
      if (!items.length || items.some((it: PurchaseItem) => !it.name)) {
        message.warning('请完整填写采购明细');
        return;
      }
      setSaving(true);
      const payload = {
        supplierId: values.supplierId,
        purchaseDate: values.purchaseDate,
        remark: values.remark,
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
      const msg = e?.response?.data?.message || e?.message || '操作失败';
      message.error(msg);
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
      const msg = e?.response?.data?.message || e?.message || '创建失败';
      message.error(msg);
    } finally {
      setCreatingSupplier(false);
    }
  };

  // 响应式监听明细，实时计算金额
  const watchedItems: PurchaseItem[] = Form.useWatch('items', form) || [];
  const totalAmount = watchedItems.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0,
  );

  return (
    <>
      <Modal
        title={editing ? '编辑采购单' : '新建采购单'}
        open={open}
        onOk={handleSave}
        onCancel={onClose}
        confirmLoading={saving}
        width={920}
        zIndex={Z_INDEX.overlay}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }}>
          <Row gutter={16}>
            <Col span={10}>
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
                      <Button
                        type="link"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setSupplierModal(true)}
                      >
                        新增供应商「{supplierKeyword}」
                      </Button>
                    </div>
                  }
                >
                  {suppliers.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name}
                      {s.contact ? `（${s.contact}${s.phone ? ' / ' + s.phone : ''}）` : ''}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="purchaseDate" label="采购日期">
                <Input type="date" placeholder="采购日期" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="采购单号" style={{ marginBottom: 4 }}>
                <Input value={editing?.purchaseNo || '保存后自动生成'} disabled style={{ color: '#8c8c8c' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider style={{ margin: '4px 0 12px', borderTop: '1px dashed rgba(5,5,5,0.06)' }} />

          <Form.Item label="采购明细" required style={{ marginBottom: 4 }}>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((field) => (
                    <Space key={field.key} align="baseline" style={{ display: 'flex', marginBottom: 8 }}>
                      <Form.Item
                        name={[field.name, 'productId']}
                        style={{ width: 260, marginBottom: 0 }}
                      >
                        <Select
                          placeholder="搜索选择产品（可选）"
                          showSearch
                          allowClear
                          filterOption={false}
                          onSearch={(v) => searchProducts(v)}
                          onChange={(val) => {
                            const p = productOptions.find((o) => o.id === val);
                            if (p) {
                              form.setFieldsValue({
                                items: (form.getFieldValue('items') || []).map((it: any, i: number) =>
                                  i === field.name
                                    ? {
                                        ...it,
                                        name: p.name,
                                        spec: [p.sizeL, p.sizeW].filter(Boolean).join('x') || '',
                                      }
                                    : it,
                                ),
                              });
                            }
                          }}
                        >
                          {productOptions.map((p) => (
                            <Select.Option key={p.id} value={p.id}>
                              {p.name}
                              {p.sku ? `（${p.sku}）` : ''}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'name']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 200, marginBottom: 0 }}
                      >
                        <Input placeholder="产品名称" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'spec']} style={{ width: 110, marginBottom: 0 }}>
                        <Input placeholder="规格" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'quantity']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 100, marginBottom: 0 }}
                      >
                        <InputNumber min={0} placeholder="数量" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'unitPrice']}
                        rules={[{ required: true, message: '必填' }]}
                        style={{ width: 120, marginBottom: 0 }}
                      >
                        <InputNumber min={0} precision={2} placeholder="单价(CNY)" style={{ width: '100%' }} />
                      </Form.Item>
                      <span style={{ width: 100, textAlign: 'right', color: '#595959', fontSize: 13 }}>
                        ¥{(
                          (Number(watchedItems[field.name]?.quantity) || 0) *
                          (Number(watchedItems[field.name]?.unitPrice) || 0)
                        ).toFixed(2)}
                      </span>
                      <MinusCircleOutlined onClick={() => remove(field.name)} style={{ color: '#ff4d4f' }} />
                    </Space>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    onClick={() => add({ name: '', quantity: 1, unitPrice: 0 })}
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
                <span style={{ color: '#8c8c8c' }}>合计金额</span>
                <span style={{ fontSize: 18, fontWeight: 600, color: '#1677ff' }}>
                  ¥{totalAmount.toFixed(2)}
                </span>
              </Space>
            </Col>
          </Row>

          <Form.Item name="remark" label="备注" style={{ marginTop: 8, marginBottom: 0 }}>
            <Input.TextArea rows={2} placeholder="备注（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 快捷新增供应商 */}
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
