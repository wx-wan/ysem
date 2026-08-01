import React from 'react';
import { Modal, Form, Input, Select, Row, Col, App } from 'antd';
import { SalesItem } from '../../api/sales';
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
  onClose: () => void;
  onSuccess: () => void;
  api: {
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
  };
}

const SalesFormModal: React.FC<Props> = React.memo(({ open, editingItem, assignUsers, initialStage, onClose, onSuccess, api }) => {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = React.useState(false);
  const stageForForm = Form.useWatch('stage', form) || 'LEAD';

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      if (editingItem) {
        await api.update(editingItem.id, values);
        message.success('更新成功');
      } else {
        await api.create(values);
        message.success('创建成功');
      }
      onClose();
      onSuccess();
    } catch (e: any) {
      if (e.errorFields) return;
    } finally {
      setSaving(false);
    }
  };

  React.useEffect(() => {
    if (open) {
      if (editingItem) {
        form.setFieldsValue(editingItem);
      } else {
        form.resetFields();
        form.setFieldsValue({ stage: initialStage || 'LEAD' });
      }
    }
  }, [open, editingItem, form, initialStage]);

  return (
    <Modal
      title={editingItem ? '编辑' : '新增'}
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={saving}
      width={720}
      zIndex={2000}
      forceRender
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
              <Input />
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
            <Form.Item name="productInterest" label="感兴趣产品">
              <Input.TextArea rows={2} />
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
                <Input type="date" />
              </Form.Item>
            </Col>
          </Row>
        )}

        {stageForForm === 'SAMPLE' && (
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="sampleType" label="样品类型">
                <Input />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleQuantity" label="样品数量">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="sampleStatus" label="样品状态">
                <Select options={[
                  { label: '待发送', value: 'PENDING' },
                  { label: '已发送', value: 'SENT' },
                  { label: '已确认', value: 'CONFIRMED' },
                  { label: '已反馈', value: 'FEEDBACK' },
                ]} />
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

        <Form.Item name="assignedTo" label="负责人">
          <Select
            allowClear
            placeholder="选择负责人"
            options={assignUsers.map((u) => ({ label: u.realName, value: u.id }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
});

export default SalesFormModal;
