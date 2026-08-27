import React from 'react';
import { Modal, Form, Input, Select, Row, Col, ConfigProvider, theme, DatePicker, Button, Space } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { SalesItem } from '../../api/sales';
import { Z_INDEX } from '../../zIndex';
import { Customer } from '../../api/customers';
import { productApi, ProductOption } from '../../api/products';
import { SALES_STAGES } from './stages';

const STAGES = SALES_STAGES;

const SOURCE_OPTIONS = [
  { label: '手动录入', value: 'MANUAL' },
  { label: 'Excel导入', value: 'EXCEL' },
  { label: '小满API', value: 'XIAOMAN' },
];

export const INTENT_OPTIONS = [
  { label: '低意向', value: '低意向' },
  { label: '中意向', value: '中意向' },
  { label: '高意向', value: '高意向' },
  { label: '准成交', value: '准成交' },
];

export const getIntentLabel = (probability: string | null | undefined): string => {
  return probability || '-';
};

interface Props {
  open: boolean;
  editingItem: SalesItem | null;
  assignUsers: Array<{ id: string; realName: string }>;
  initialStage?: string;
  /** 详情场景：由父级传入的客户（公司名称固定、基础信息带出、负责人不可改） */
  customer?: Customer | null;
  /** 当前用户 id：详情场景下作为默认负责人 */
  currentUserId?: string;
  /** 详情场景：禁用负责人选择 */
  fixedOwner?: boolean;
  /** 销售页独立新建：全部客户下拉选项（含 raw 客户） */
  customerOptions?: Array<{ label: string; value: string; raw?: Customer }>;
  /** 产品选项：用于线索关联产品（由父级传入或全部加载） */
  productOptions?: ProductOption[];
  onClose: () => void;
  /** 保存成功：组件只负责校验并回传（数字已转换后的）值，
   *  持久化与前端缓存更新交由父级统一处理（先更新前端缓存保持一致，最后落库） */
  onSuccess: (values: any) => void;
}

const SalesFormModal: React.FC<Props> = React.memo(({ open, editingItem, assignUsers, initialStage, customer, currentUserId, fixedOwner, customerOptions, productOptions, onClose, onSuccess }) => {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);
  const [innerProductOptions, setInnerProductOptions] = React.useState<ProductOption[]>(productOptions || []);
  const stageForForm = Form.useWatch('stage', form) || 'LEAD';

  // 若父级未传入产品选项，则自行加载
  React.useEffect(() => {
    if (productOptions && productOptions.length) {
      setInnerProductOptions(productOptions);
    } else if (open) {
      productApi.options().then((res) => {
        if (res.data.code === 200) setInnerProductOptions(res.data.data);
      }).catch(() => {});
    }
  }, [productOptions, open]);

  const handleSubmit = async () => {
    try {
      const raw = await form.validateFields();
      // 将数字输入转为 number 类型
      const values = {
        ...raw,
        estimatedAmount: raw.estimatedAmount ? Number(raw.estimatedAmount) : undefined,
        orderAmount: raw.orderAmount ? Number(raw.orderAmount) : undefined,
        estimatedCloseDate: raw.estimatedCloseDate
          ? (dayjs.isDayjs(raw.estimatedCloseDate) ? raw.estimatedCloseDate.format('YYYY-MM-DD') : raw.estimatedCloseDate)
          : undefined,
        products: Array.isArray(raw.products)
          ? raw.products
              .filter((p: any) => p && p.productId)
              .map((p: any) => ({ productId: p.productId, quantity: p.quantity ? Number(p.quantity) : 1 }))
          : undefined,
      };
      setSaving(true);
      // 仅回传校验后的值，由父级负责：先更新前端缓存保持一致，再持久化到数据库
      onSuccess(values);
      onClose();
    } catch (e: any) {
      if (e.errorFields) return; // 校验失败，不关闭
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      // 详情场景：客户基础信息作为默认值带出（editingItem 已有值则优先）
      const baseInfo: Record<string, any> = customer
        ? {
            companyName: customer.companyName,
            contactName: customer.contactName,
            phone: customer.phone,
            email: customer.email,
            country: customer.country,
            assignedTo: fixedOwner ? currentUserId : undefined,
          }
        : {};
      if (editingItem) {
        // 先设置 stage，让对应阶段的条件字段先挂载，
        // 条件字段（OPPORTUNITY / ORDER 等）依赖 Form.useWatch 异步渲染，
        // 因此按当前 stage 精确轮询等待对应字段实例就绪后再整体赋值，
        // 避免未挂载的字段（如预计成交金额、预计成交时间）拿不到值
        form.setFieldsValue({ stage: editingItem.stage || 'LEAD' });
        const stage = editingItem.stage || 'LEAD';
        const waitFor = {
          LEAD: undefined,
          OPPORTUNITY: 'estimatedAmount',
          ORDER: 'orderAmount',
        }[stage];
        let raf = 0;
        const tryFill = () => {
          if (!waitFor || form.getFieldInstance(waitFor)) {
            form.setFieldsValue({
              ...baseInfo,
              ...editingItem,
              estimatedCloseDate: editingItem.estimatedCloseDate ? dayjs(editingItem.estimatedCloseDate) : undefined,
              products: editingItem.leadProducts?.length
                ? editingItem.leadProducts.map((p) => ({ productId: p.productId, quantity: p.quantity }))
                : undefined,
            });
          } else {
            raf = requestAnimationFrame(tryFill);
          }
        };
        raf = requestAnimationFrame(tryFill);
        return () => cancelAnimationFrame(raf);
      } else {
        form.resetFields();
        form.setFieldsValue({
          stage: initialStage || 'LEAD',
          ...baseInfo,
          assignedTo: fixedOwner ? currentUserId : undefined,
        });
      }
    }
  }, [open, editingItem, form, initialStage]);

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 8,
          borderRadiusLG: 16,
          fontFamily: "'Montserrat', 'SourceHanSansCN', -apple-system, BlinkMacSystemFont, sans-serif",
        },
        components: {
          Modal: {
            borderRadiusLG: 16,
            borderRadiusSM: 12,
            titleFontSize: 16,
            titleColor: 'rgba(0,0,0,0.88)',
          },
          Form: {
            labelColor: '#64748b',
            labelFontSize: 13,
            itemMarginBottom: 18,
          },
          Input: {
            borderRadius: 8,
            hoverBorderColor: '#1677ff',
            activeBorderColor: '#1677ff',
          },
          Select: {
            borderRadius: 8,
            hoverBorderColor: '#1677ff',
            activeBorderColor: '#1677ff',
          },
          Button: {
            primaryShadow: '0 2px 8px rgba(22,119,255,0.25)',
          },
        },
      }}
    >
      <Modal
        title={editingItem ? '编辑商机' : '新增商机'}
        open={open}
        onCancel={onClose}
        onOk={handleSubmit}
        okText={editingItem ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        width={720}
        zIndex={Z_INDEX.overlay}
        forceRender
        styles={{
          header: { borderBottom: '1px solid rgba(0,0,0,0.06)', padding: '16px 20px' },
          body: { padding: '20px 24px' },
          footer: { borderTop: '1px solid rgba(0,0,0,0.06)', padding: '12px 20px' },
        }}
        okButtonProps={{ style: { background: token.colorPrimary, fontWeight: 600 } }}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="title" label="标题" rules={[{ required: true }]}>
                <Input placeholder="如：ABC公司询价" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="stage" label="阶段">
                <Select options={STAGES.map((s) => ({ label: s.label, value: s.key }))} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
                {customer ? (
                  <Input disabled />
                ) : (
                  <Select
                    showSearch
                    placeholder="选择客户"
                    optionFilterProp="label"
                    options={customerOptions}
                    onChange={(value) => {
                      const opt = customerOptions?.find((o) => o.value === value);
                      if (opt?.raw) {
                        form.setFieldsValue({
                          companyName: opt.raw.companyName,
                          contactName: opt.raw.contactName,
                          phone: opt.raw.phone,
                          email: opt.raw.email,
                          country: opt.raw.country,
                        });
                      }
                    }}
                  />
                )}
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="contactName" label="联系人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="country" label="国家">
                <Input />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="phone" label="电话">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="source" label="来源">
                <Select options={SOURCE_OPTIONS} />
              </Form.Item>
            </Col>
          </Row>

          {stageForForm === 'LEAD' && (
            <>
              <Form.Item label="关联产品" tooltip="线索由产品产生，可关联多个产品及其数量">
                <Form.List name="products">
                  {(fields, { add, remove }) => (
                    <>
                      {fields.map(({ key, name, ...restField }) => (
                        <Space key={key} align="baseline" style={{ display: 'flex', marginBottom: 8 }} wrap>
                          <Form.Item
                            {...restField}
                            name={[name, 'productId']}
                            rules={[{ required: true, message: '请选择产品' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              showSearch
                              placeholder="选择产品"
                              style={{ width: 320 }}
                              optionFilterProp="label"
                              options={innerProductOptions.map((p) => ({
                                label: `${p.name}${p.sku ? `（${p.sku}）` : ''}`,
                                value: p.id,
                              }))}
                            />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'quantity']}
                            initialValue={1}
                            style={{ marginBottom: 0 }}
                          >
                            <Input type="number" min={1} placeholder="数量" style={{ width: 100 }} />
                          </Form.Item>
                          <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#bbb' }} />
                        </Space>
                      ))}
                      <Button
                        type="dashed"
                        onClick={() => add({ quantity: 1 })}
                        block
                        icon={<PlusOutlined />}
                        style={{ marginTop: fields.length ? 0 : 0 }}
                      >
                        添加关联产品
                      </Button>
                    </>
                  )}
                </Form.List>
              </Form.Item>
              <Form.Item name="leadNotes" label="备注">
                <Input.TextArea rows={2} />
              </Form.Item>
            </>
          )}

          {stageForForm === 'OPPORTUNITY' && (
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="estimatedAmount" label="预估金额（CNY）">
                  <Input type="number" prefix="¥" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="probability" label="采购意向">
                  <Select
                    placeholder="选择意向"
                    allowClear
                    options={INTENT_OPTIONS}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="estimatedCloseDate" label="预计成交日期">
                  <DatePicker
                    style={{ width: '100%' }}
                    placeholder="选择预计成交日期"
                    disabledDate={(current) => !!current && current < dayjs().startOf('day')}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {stageForForm === 'ORDER' && (
            <>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="orderAmount" label="订单金额（CNY）">
                    <Input type="number" prefix="¥" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="orderDate" label="下单日期">
                    <Input type="date" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="deliveryDate" label="交付日期">
                    <Input type="date" />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="paymentTerms" label="付款条件">
                    <Input />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="orderStatus" label="订单状态">
                    <Select options={[
                      { label: '待确认', value: 'PENDING' },
                      { label: '已确认', value: 'CONFIRMED' },
                      { label: '生产中', value: 'IN_PRODUCTION' },
                      { label: '已发货', value: 'SHIPPED' },
                      { label: '已交付', value: 'DELIVERED' },
                    ]} />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          <Form.Item
            name="assignedTo"
            label="负责人"
            tooltip={fixedOwner ? '当前场景下负责人默认为您本人，不可修改' : undefined}
          >
            <Select
              allowClear={!fixedOwner}
              disabled={fixedOwner}
              placeholder={fixedOwner ? '默认当前用户' : '选择负责人'}
              options={assignUsers.map((u) => ({ label: u.realName, value: u.id }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </ConfigProvider>
  );
});

export default SalesFormModal;
