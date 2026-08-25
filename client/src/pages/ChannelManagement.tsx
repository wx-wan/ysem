import { useEffect, useState, useCallback } from 'react';
import { Table, Button, Space, Tag, App, Drawer, Form, Input, Select, Switch, InputNumber, Popconfirm, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, ApartmentOutlined, ShopOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { channelApi, type Channel, type ChannelPayload } from '../api/channel';

const CATEGORY_META: Record<string, { color: string; label: string }> = {
  ONLINE: { color: 'blue', label: 'channel.catOnline' },
  OFFLINE: { color: 'orange', label: 'channel.catOffline' },
};

export default function ChannelManagement() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Channel[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [parentForChild, setParentForChild] = useState<Channel | null>(null); // 新增子店铺时的父平台
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await channelApi.tree();
      setData(res.data);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (parent?: Channel) => {
    setEditing(null);
    setParentForChild(parent ?? null);
    form.resetFields();
    form.setFieldsValue({
      category: parent ? parent.category : 'ONLINE',
      status: 'ENABLED',
      sort: 0,
      parentId: parent ? parent.id : null,
    });
    setDrawerOpen(true);
  };

  const openEdit = (record: Channel) => {
    setEditing(record);
    setParentForChild(null);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      category: record.category,
      parentId: record.parentId,
      contact: record.contact ?? undefined,
      status: record.status,
      sort: record.sort,
      remark: record.remark ?? undefined,
    });
    setDrawerOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload: ChannelPayload = {
      name: values.name,
      category: values.category,
      parentId: values.parentId ?? null,
      contact: values.contact,
      status: values.status,
      sort: values.sort ?? 0,
      remark: values.remark,
    };
    try {
      if (editing) {
        await channelApi.update(editing.id, payload);
        message.success(t('common.updateSuccess'));
      } else {
        await channelApi.create(payload);
        message.success(t('common.createSuccess'));
      }
      setDrawerOpen(false);
      load();
    } catch (err: any) {
      message.error(err?.response?.data?.message || t('common.saveFailed'));
    }
  };

  const remove = async (record: Channel) => {
    try {
      await channelApi.delete(record.id);
      message.success(t('common.deleteSuccess'));
      load();
    } catch {
      message.error(t('common.deleteFailed'));
    }
  };

  const columns: ColumnsType<Channel> = [
    {
      title: t('channel.name'),
      dataIndex: 'name',
      render: (text: string, r) =>
        r.parentId ? (
          <Space>
            <ShopOutlined style={{ color: '#999' }} />
            {text}
          </Space>
        ) : (
          <Space>
            <ApartmentOutlined style={{ color: '#1677ff' }} />
            <strong>{text}</strong>
          </Space>
        ),
    },
    {
      title: t('channel.category'),
      dataIndex: 'category',
      width: 120,
      render: (c: string) => <Tag color={CATEGORY_META[c]?.color}>{t(CATEGORY_META[c]?.label)}</Tag>,
    },
    {
      title: t('channel.contact'),
      dataIndex: 'contact',
      render: (v?: string | null) => v || '-',
    },
    {
      title: t('channel.status'),
      dataIndex: 'status',
      width: 100,
      render: (s: string) =>
        s === 'ENABLED' ? (
          <Tag color="green">{t('channel.enabled')}</Tag>
        ) : (
          <Tag color="default">{t('channel.disabled')}</Tag>
        ),
    },
    {
      title: t('channel.sort'),
      dataIndex: 'sort',
      width: 80,
    },
    {
      title: t('common.operation'),
      width: 200,
      render: (_: unknown, record: Channel) => (
        <Space>
          {!record.parentId && (
            <Tooltip title={t('channel.addShop')}>
              <Button type="link" size="small" onClick={() => openCreate(record)}>
                {t('channel.addShop')}
              </Button>
            </Tooltip>
          )}
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>
            {t('common.edit')}
          </Button>
          <Popconfirm title={t('common.confirmDelete')} onConfirm={() => remove(record)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              {t('common.delete')}
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="setting-pane">
      <div className="setting-pane-head">
        <div>
          <h2 className="setting-pane-title">{t('menu.systemChannel')}</h2>
          <p className="setting-pane-desc">{t('channel.desc')}</p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t('common.refresh')}
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openCreate()}>
            {t('channel.addPlatform')}
          </Button>
        </Space>
      </div>

      <Table<Channel>
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={false}
        childrenColumnName="children"
        expandable={{ defaultExpandAllRows: true }}
        size="middle"
      />

      <Drawer
        title={editing ? t('channel.editTitle') : parentForChild ? t('channel.addShopTitle') : t('channel.addPlatformTitle')}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={440}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel')}</Button>
            <Button type="primary" onClick={submit}>
              {t('common.save')}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label={t('channel.name')} rules={[{ required: true, message: t('channel.nameRequired') }]}>
            <Input placeholder={t('channel.namePlaceholder')} />
          </Form.Item>
          <Form.Item name="category" label={t('channel.category')} rules={[{ required: true }]}>
            <Select
              disabled={!!parentForChild}
              options={[
                { value: 'ONLINE', label: t('channel.catOnline') },
                { value: 'OFFLINE', label: t('channel.catOffline') },
              ]}
            />
          </Form.Item>
          <Form.Item name="parentId" label={t('channel.parent')} hidden>
            <Input />
          </Form.Item>
          {parentForChild && (
            <Form.Item label={t('channel.belongPlatform')}>
              <Tag color="blue">{parentForChild.name}</Tag>
            </Form.Item>
          )}
          <Form.Item name="contact" label={t('channel.contact')}>
            <Input placeholder={t('channel.contactPlaceholder')} />
          </Form.Item>
          <Form.Item name="status" label={t('channel.status')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'ENABLED', label: t('channel.enabled') },
                { value: 'DISABLED', label: t('channel.disabled') },
              ]}
            />
          </Form.Item>
          <Form.Item name="sort" label={t('channel.sort')}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label={t('channel.remark')}>
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Drawer>
    </div>
  );
}
