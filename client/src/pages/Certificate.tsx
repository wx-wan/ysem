import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Image, Tag,
  Popconfirm, App, DatePicker, Card,
} from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';
import { certificateApi, Certificate } from '../api/certificates';
import ImageUploadCropper from '../components/common/ImageUploadCropper';

const { TextArea } = Input;

export default function CertificatePage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();

  const [list, setList] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Certificate | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await certificateApi.list();
      if (res.data.code === 200 || res.data.code === 0) setList(res.data.data);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 1 });
    setModalOpen(true);
  };

  const handleEdit = (record: Certificate) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({
      ...record,
      validUntil: record.validUntil ?? undefined,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await certificateApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = { ...values };
      if (values.validUntil) {
        // antd DatePicker 返回 dayjs 对象，转 ISO 字符串
        payload.validUntil = values.validUntil.toISOString
          ? values.validUntil.toISOString()
          : String(values.validUntil);
      }
      if (editing) {
        await certificateApi.update(editing.id, payload);
        message.success('更新成功');
      } else {
        await certificateApi.create(payload);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch {
      /* validation */
    }
  };

  const columns = [
    {
      title: 'Logo', dataIndex: 'logo', key: 'logo', width: 80, align: 'center',
      render: (src: string | null) =>
        src
          ? (
            <Image
              src={src}
              width={20}
              height={20}
              style={{ objectFit: 'cover', borderRadius: 4 }}
              preview={{ mask: '查看' }}
            />
          )
          : <span style={{ color: '#bbb' }}>—</span>,
    },
    { title: '证书名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '编号/标准', dataIndex: 'code', key: 'code', width: 130, render: (c: string | null) => c || '-' },
    { title: '分类', dataIndex: 'category', key: 'category', width: 110, render: (c: string | null) => c || '-' },
    { title: '发证机构', dataIndex: 'issuer', key: 'issuer', width: 130, render: (c: string | null) => c || '-' },
    {
      title: '有效期至', dataIndex: 'validUntil', key: 'validUntil', width: 120,
      render: (v: string | null) => (v ? v.slice(0, 10) : '长期'),
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: number) => (
        <Tag color={s === 1 ? 'success' : 'default'} variant="filled">{s === 1 ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: t('common.operation') || '操作', key: 'action', width: 130, fixed: 'right' as const,
      render: (_: unknown, record: Certificate) => (
        <span className="pm-actions">
          {hasPerm('certificate:update') && (
            <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          )}
          {hasPerm('certificate:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="pt-container">
      <div className="page-header">
        <div>
          <h2>{t('menu.systemCertificates') || '证书管理'}</h2>
          <p className="page-header-desc">维护认证资质证书，可在产品新建时关联绑定</p>
        </div>
      </div>

      <Card className="pt-card" styles={{ body: { padding: 0 } }}>
        <div className="pt-toolbar">
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          {hasPerm('certificate:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增证书</Button>
          )}
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={list}
          loading={loading}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? '编辑证书' : '新增证书'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="name" label="证书名称" rules={[{ required: true, message: '请输入证书名称' }]}>
            <Input placeholder="如 CE 认证" />
          </Form.Item>
          <Form.Item name="code" label="编号 / 标准代号" extra="如 CE、FCC、EN71">
            <Input placeholder="输入编号或标准代号" maxLength={50} />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input placeholder="如 安全 / 电磁兼容 / 环保" maxLength={50} />
          </Form.Item>
          <Form.Item name="issuer" label="发证机构">
            <Input placeholder="如 SGS" maxLength={100} />
          </Form.Item>
          <Form.Item name="logo" label="证书 Logo">
            <ImageUploadCropper
              uploadUrl="/upload"
              urlField="data.url"
              shape="square"
              size={120}
              cropSquare
              placeholder="上传证书 Logo"
              onUploaded={(url) => form.setFieldValue('logo', url)}
            />
          </Form.Item>
          <Form.Item name="validUntil" label="有效期至">
            <DatePicker style={{ width: '100%' }} placeholder="选择有效期，留空表示长期" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue={1}>
            <Select options={[{ label: '启用', value: 1 }, { label: '停用', value: 0 }]} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <TextArea rows={2} placeholder="备注信息" maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
