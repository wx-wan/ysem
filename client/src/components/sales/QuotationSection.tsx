import React, { useEffect, useState } from 'react';
import { Card, Button, Table, Tag, Space, Modal, Form, Input, InputNumber, DatePicker, Select, message, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { quotationApi, type Quotation } from '../../api/quotations';

const STATUS_OPTIONS = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已发送', value: 'SENT' },
  { label: '已接受', value: 'ACCEPTED' },
  { label: '已拒绝', value: 'REJECTED' },
];
const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'red',
};

interface Props {
  opportunityId: string;
  productId?: string;
}

const QuotationSection: React.FC<Props> = ({ opportunityId, productId }) => {
  const { t } = useTranslation();
  const [list, setList] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [form] = Form.useForm();

  const fetchList = async () => {
    setLoading(true);
    try {
      const res: any = await quotationApi.list({ opportunityId, pageSize: 100 });
      setList(res?.data?.list ?? res?.list ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (opportunityId) fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opportunityId]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency: 'USD', status: 'DRAFT', version: (list.length || 0) + 1 });
    setModalOpen(true);
  };

  const openEdit = (record: Quotation) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      validUntil: record.validUntil ? dayjs(record.validUntil) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: any = {
      opportunityId,
      productId: productId ?? null,
      title: values.title,
      amount: values.amount,
      currency: values.currency,
      validUntil: values.validUntil ? values.validUntil.format('YYYY-MM-DD') : null,
      status: values.status,
      notes: values.notes || null,
    };
    try {
      if (editing) {
        await quotationApi.update(editing.id, payload);
        message.success(t('common.updateSuccess'));
      } else {
        await quotationApi.create(payload);
        message.success(t('common.createSuccess'));
      }
      setModalOpen(false);
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('common.saveFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await quotationApi.remove(id);
      message.success(t('common.deleteSuccess'));
      fetchList();
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.message || t('common.deleteFailed'));
    }
  };

  const columns = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 56,
      render: (v: number) => `v${v}`,
    },
    { title: '标题', dataIndex: 'title' },
    {
      title: '金额',
      dataIndex: 'amount',
      render: (v: number, r: Quotation) => `${r.currency} ${v?.toLocaleString()}`,
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={STATUS_COLOR[s]}>{STATUS_OPTIONS.find((o) => o.value === s)?.label}</Tag>,
    },
    {
      title: '有效期',
      dataIndex: 'validUntil',
      render: (v?: string) => (v ? dayjs(v).format('YYYY-MM-DD') : '-'),
    },
    {
      title: '操作',
      width: 110,
      render: (_: any, r: Quotation) => (
        <Space>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" type="link" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="报价"
      size="small"
      style={{ marginTop: 16 }}
      extra={
        <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>
          新建报价
        </Button>
      }
    >
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={list}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '暂无报价' }}
      />

      <Modal
        title={editing ? '编辑报价' : '新建报价'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" initialValues={{ currency: 'USD', status: 'DRAFT' }}>
          <Form.Item name="title" label="报价标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：初版报价 /  revised quote" />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]} style={{ flex: 1 }}>
              <InputNumber style={{ width: '100%' }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="currency" label="币种" style={{ width: 120 }}>
              <Select options={[{ label: 'USD', value: 'USD' }, { label: 'CNY', value: 'CNY' }, { label: 'EUR', value: 'EUR' }]} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="validUntil" label="有效期至" style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 160 }}>
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default QuotationSection;
