import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Input,
  Modal,
  Form,
  Switch,
  Table,
  Space,
  Popconfirm,
  message,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  EditOutlined,
  DeleteOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import customerTypeApi, { CustomerType, CustomerTypeInput } from '../api/customerType';
import PageSkeleton from '../components/PageSkeleton';

export default function SettingsCustomerType() {
  const { t } = useTranslation();
  const [list, setList] = useState<CustomerType[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerType | null>(null);
  const [form] = Form.useForm();

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await customerTypeApi.getAll(keyword);
      setList(res.data.data || []);
    } finally {
      setLoading(false);
    }
  }, [keyword]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: CustomerType) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      isActive: record.isActive,
      sort: record.sort,
    });
    setModalOpen(true);
  };

  const handleSave = async (values: CustomerTypeInput) => {
    try {
      if (editing) {
        await customerTypeApi.update(editing.id, values);
        message.success(t('common.saved'));
      } else {
        await customerTypeApi.create(values);
        message.success(t('common.created'));
      }
      setModalOpen(false);
      fetchList();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await customerTypeApi.delete(id);
      message.success(t('common.deleted'));
      fetchList();
    } catch {
      message.error(t('common.deleteFailed'));
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const newList = [...list];
    const temp = newList[index];
    newList[index] = newList[targetIndex];
    newList[targetIndex] = temp;
    // 重新分配 sort
    const updated = newList.map((item, i) => ({ id: item.id, sort: (i + 1) * 10 }));
    try {
      await customerTypeApi.updateSort(updated);
      message.success(t('common.saved'));
      fetchList();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const toggleActive = async (record: CustomerType) => {
    try {
      await customerTypeApi.update(record.id, { isActive: !record.isActive });
      message.success(t('common.saved'));
      fetchList();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const columns = [
    {
      title: t('customerType.name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('customerType.description'),
      dataIndex: 'description',
      key: 'description',
      render: (v: string | null) => v || '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (_: boolean, record: CustomerType) => (
        <Switch
          checked={record.isActive}
          onChange={() => toggleActive(record)}
          checkedChildren={t('common.enable')}
          unCheckedChildren={t('common.disable')}
        />
      ),
    },
    {
      title: t('common.sort'),
      dataIndex: 'sort',
      key: 'sort',
      width: 120,
      render: (_: number, record: CustomerType, index: number) => (
        <Space>
          <span>{record.sort}</span>
          <Button
            type="text"
            size="small"
            icon={<ArrowUpOutlined />}
            disabled={index === 0}
            onClick={() => move(index, -1)}
          />
          <Button
            type="text"
            size="small"
            icon={<ArrowDownOutlined />}
            disabled={index === list.length - 1}
            onClick={() => move(index, 1)}
          />
        </Space>
      ),
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 140,
      render: (_: unknown, record: CustomerType, index: number) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            {t('common.edit')}
          </Button>
          <Popconfirm
            title={t('common.confirmDelete')}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {loading && list.length === 0 ? (
        <PageSkeleton rows={6} />
      ) : (
        <>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            {t('customerType.settingHint')}
          </Typography.Paragraph>

          <Card
            title={t('customerType.title')}
            extra={
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                {t('common.add')}
              </Button>
            }
          >
            <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
              <Input
                placeholder={t('customerType.searchPlaceholder')}
                prefix={<SearchOutlined />}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onPressEnter={fetchList}
                allowClear
              />
              <Button onClick={fetchList}>{t('common.search')}</Button>
            </div>

            <Table
              rowKey="id"
              columns={columns}
              dataSource={list}
              loading={loading && list.length > 0}
              pagination={false}
              size="middle"
            />
          </Card>
        </>
      )}

      <Modal
        title={editing ? t('customerType.edit') : t('customerType.add')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="name"
            label={t('customerType.name')}
            rules={[{ required: true, message: t('customerType.nameRequired') }]}
          >
            <Input placeholder={t('customerType.namePlaceholder')} maxLength={50} showCount />
          </Form.Item>
          <Form.Item name="description" label={t('customerType.description')}>
            <Input.TextArea
              placeholder={t('customerType.descriptionPlaceholder')}
              rows={3}
              maxLength={200}
              showCount
            />
          </Form.Item>
          <Form.Item
            name="sort"
            label={t('common.sort')}
            initialValue={editing ? undefined : (list.length + 1) * 10}
          >
            <Input type="number" placeholder={t('customerType.sortPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="isActive"
            label={t('common.status')}
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren={t('common.enable')} unCheckedChildren={t('common.disable')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
