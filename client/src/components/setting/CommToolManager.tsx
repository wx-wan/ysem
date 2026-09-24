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
import commToolApi, { CommunicationTool, CommunicationToolInput } from '../../api/commTool';
import { useCommToolStore } from '../../stores/useCommToolStore';

export default function CommToolManager() {
  const { t } = useTranslation();
  const [list, setList] = useState<CommunicationTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CommunicationTool | null>(null);
  const [form] = Form.useForm();
  const invalidateCommTools = useCommToolStore((s) => s.invalidate);

  const syncDropdownOptions = useCallback(() => {
    void invalidateCommTools();
  }, [invalidateCommTools]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await commToolApi.getAll(keyword);
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

  const openEdit = (record: CommunicationTool) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      description: record.description,
      isActive: record.isActive,
      sort: record.sort,
    });
    setModalOpen(true);
  };

  const handleSave = async (values: CommunicationToolInput) => {
    try {
      if (editing) {
        await commToolApi.update(editing.id, values);
        message.success(t('common.saved'));
      } else {
        await commToolApi.create(values);
        message.success(t('common.created'));
      }
      setModalOpen(false);
      fetchList();
      syncDropdownOptions();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await commToolApi.delete(id);
      message.success(t('common.deleted'));
      fetchList();
      syncDropdownOptions();
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
    const updated = newList.map((item, i) => ({ id: item.id, sort: (i + 1) * 10 }));
    try {
      await commToolApi.updateSort(updated);
      message.success(t('common.saved'));
      fetchList();
      syncDropdownOptions();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const toggleActive = async (record: CommunicationTool) => {
    try {
      await commToolApi.update(record.id, { isActive: !record.isActive });
      message.success(t('common.saved'));
      fetchList();
      syncDropdownOptions();
    } catch {
      message.error(t('common.saveFailed'));
    }
  };

  const columns = [
    {
      title: t('commTool.name'),
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: t('commTool.description'),
      dataIndex: 'description',
      key: 'description',
      render: (v: string | null) => v || '-',
    },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (_: boolean, record: CommunicationTool) => (
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
      render: (_: number, record: CommunicationTool, index: number) => (
        <Space>
          <span>{record.sort}</span>
          <Button type="text" size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} />
          <Button type="text" size="small" icon={<ArrowDownOutlined />} disabled={index === list.length - 1} onClick={() => move(index, 1)} />
        </Space>
      ),
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 140,
      render: (_: unknown, record: CommunicationTool, index: number) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            {t('common.edit')}
          </Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t('commTool.settingHint')}
      </Typography.Paragraph>

      <Card
        title={t('commTool.title')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            {t('common.add')}
          </Button>
        }
      >
        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <Input
            placeholder={t('commTool.searchPlaceholder')}
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
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      <Modal
        title={editing ? t('commTool.edit') : t('commTool.add')}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item name="name" label={t('commTool.name')} rules={[{ required: true, message: t('commTool.nameRequired') }]}>
            <Input placeholder={t('commTool.namePlaceholder')} maxLength={50} showCount />
          </Form.Item>
          <Form.Item name="description" label={t('commTool.description')}>
            <Input.TextArea placeholder={t('commTool.descriptionPlaceholder')} rows={3} maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="sort" label={t('common.sort')} initialValue={editing ? undefined : (list.length + 1) * 10}>
            <Input type="number" placeholder={t('commTool.sortPlaceholder')} />
          </Form.Item>
          <Form.Item name="isActive" label={t('common.status')} valuePropName="checked" initialValue={true}>
            <Switch checkedChildren={t('common.enable')} unCheckedChildren={t('common.disable')} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
