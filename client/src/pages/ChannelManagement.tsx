import { useEffect, useState, useCallback } from 'react';
import {
  Button, Space, Tag, App, Drawer, Form, Input, Select, InputNumber, Popconfirm,
  Row, Col, Card, Dropdown, Empty, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  ApartmentOutlined, ShopOutlined, MoreOutlined, GlobalOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useTranslation } from 'react-i18next';
import { channelApi, type Channel, type ChannelPayload } from '../api/channel';
import PageSkeleton from '../components/PageSkeleton';

// 类别语义色：线上=主色，线下=警示色（均走 antd 预设语义 Tag，与 --c-* 体系一致）
const CAT_TAG: Record<string, { tag: string; icon: React.ReactNode }> = {
  ONLINE: { tag: 'blue', icon: <GlobalOutlined style={{ color: 'var(--c-primary)' }} /> },
  OFFLINE: { tag: 'orange', icon: <EnvironmentOutlined style={{ color: 'var(--c-warning)' }} /> },
};

export default function ChannelManagement() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Channel[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Channel | null>(null);
  const [parentForChild, setParentForChild] = useState<Channel | null>(null);
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

  const onlineCount = data.filter((c) => c.category === 'ONLINE').length;
  const offlineCount = data.filter((c) => c.category === 'OFFLINE').length;
  const shopTotal = data.reduce((acc, c) => acc + (c.children?.length || 0), 0);

  const platformMenu = (record: Channel): MenuProps => ({
    items: [
      { key: 'edit', label: t('common.edit'), icon: <EditOutlined /> },
      { key: 'delete', label: t('common.delete'), icon: <DeleteOutlined />, danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'edit') openEdit(record);
      if (key === 'delete') remove(record);
    },
  });

  const shopMenu = (shop: Channel): MenuProps => ({
    items: [
      { key: 'edit', label: t('common.edit'), icon: <EditOutlined /> },
      { key: 'delete', label: t('common.delete'), icon: <DeleteOutlined />, danger: true },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'edit') openEdit(shop);
      if (key === 'delete') remove(shop);
    },
  });

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>{t('menu.systemChannel')}</h2>
          <p className="page-header-desc">{t('channel.desc')}</p>
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

      {loading && data.length === 0 ? (
        <PageSkeleton variant="cards" statCards={3} rows={6} title={false} />
      ) : (
        <>
          {/* 概览统计：上面显示总数，下面标注；卡片加高 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {[
          { color: 'var(--c-primary)', icon: <ApartmentOutlined />, value: data.length, label: t('channel.totalPlatform') },
          { color: 'var(--c-primary)', icon: <GlobalOutlined />, value: onlineCount, label: t('channel.catOnline') },
          { color: 'var(--c-warning)', icon: <EnvironmentOutlined />, value: offlineCount, label: t('channel.catOffline') },
        ].map((s, i) => (
          <Col xs={12} md={8} key={i}>
            <Card size="small" variant="borderless" className="channel-platform-card" style={{ minHeight: 108 }}>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 14, height: '100%', minHeight: 88, paddingLeft: 6 }}>
                <span style={{ fontSize: 26, color: s.color, display: 'inline-flex' }}>{s.icon}</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: 'var(--c-text)' }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-secondary)', marginTop: 6 }}>{s.label}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {/* 平台卡片网格 */}
      {data.length === 0 && !loading ? (
        <Empty description={t('channel.emptyPlatform')} style={{ padding: '60px 0' }} />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((platform) => {
            const meta = CAT_TAG[platform.category] || CAT_TAG.ONLINE;
            const shops = platform.children || [];
            return (
              <Col xs={24} md={12} xl={8} key={platform.id}>
                <Card
                  className="channel-platform-card"
                  loading={loading}
                  styles={{ body: { paddingTop: 14 } }}
                  title={
                    <Space>
                      <span style={{ color: platform.category === 'ONLINE' ? 'var(--c-primary)' : 'var(--c-warning)', fontSize: 16 }}>{meta.icon}</span>
                      <span style={{ fontWeight: 600, color: 'var(--c-text)' }}>{platform.name}</span>
                      <Tag color={meta.tag}>{t(platform.category === 'ONLINE' ? 'channel.catOnline' : 'channel.catOffline')}</Tag>
                      {platform.status === 'DISABLED' && <Tag>{t('channel.disabled')}</Tag>}
                    </Space>
                  }
                  extra={
                    <Space size={4}>
                      <Tooltip title={t('channel.addShop')}>
                        <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCreate(platform)} />
                      </Tooltip>
                      <Dropdown menu={platformMenu(platform)} trigger={['click']}>
                        <Button type="text" size="small" icon={<MoreOutlined />} />
                      </Dropdown>
                    </Space>
                  }
                >
                  <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--c-text-secondary)' }}>
                    {t('channel.shopCount', { n: shops.length })}
                    {platform.contact && (
                      <span style={{ marginInlineStart: 12 }}>
                        {t('channel.contact')}：{platform.contact}
                      </span>
                    )}
                  </div>

                  {shops.length === 0 ? (
                    <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: 'var(--c-text-secondary)', border: '1px dashed var(--c-border)', borderRadius: 'var(--radius-sm)' }}>
                      {t('channel.emptyShop')}
                    </div>
                  ) : (
                    <Space wrap size={[8, 8]}>
                      {shops.map((shop) => (
                        <Dropdown key={shop.id} menu={shopMenu(shop)} trigger={['click']}>
                          <Button
                            size="small"
                            icon={<ShopOutlined style={{ color: platform.category === 'ONLINE' ? 'var(--c-primary)' : 'var(--c-warning)', fontSize: 12 }} />}
                            disabled={shop.status === 'DISABLED'}
                          >
                            {shop.name}
                          </Button>
                        </Dropdown>
                      ))}
                    </Space>
                  )}

                  {platform.remark && (
                    <div style={{ marginTop: 12, fontSize: 12, color: 'var(--c-text-tertiary)', lineHeight: 1.5 }}>
                      {platform.remark}
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
        </>
      )}

      {/* 新建 / 编辑抽屉 */}
      <Drawer
        title={editing ? t('channel.editTitle') : parentForChild ? t('channel.addShopTitle') : t('channel.addPlatformTitle')}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        size={440}
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
