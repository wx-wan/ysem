import { useEffect, useState, useCallback } from 'react';
import {
  Button, Space, Tag, App, Drawer, Form, Input, Select, InputNumber, Popconfirm,
  Row, Col, Card, Dropdown, Empty, Tooltip, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  ApartmentOutlined, ShopOutlined, MoreOutlined, GlobalOutlined, ShopTwoTone,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { channelApi, type Channel, type ChannelPayload } from '../api/channel';

const CATEGORY_META: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  ONLINE: { color: '#1677ff', bg: '#e6f4ff', label: 'channel.catOnline', icon: <GlobalOutlined /> },
  OFFLINE: { color: '#fa8c16', bg: '#fff7e6', label: 'channel.catOffline', icon: <ShopTwoTone /> },
};

export default function ChannelManagement() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
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

      {/* 概览统计 */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col xs={12} md={8}>
          <Card size="small" variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Space align="center">
              <span style={{ fontSize: 22, color: token.colorPrimary }}><ApartmentOutlined /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{data.length}</div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('channel.addPlatform')}</div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card size="small" variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Space align="center">
              <span style={{ fontSize: 22, color: '#1677ff' }}><GlobalOutlined /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{t('channel.onlineCount', { n: onlineCount })}</div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('channel.catOnline')}</div>
              </div>
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card size="small" variant="borderless" style={{ borderRadius: token.borderRadiusLG, border: `1px solid ${token.colorBorderSecondary}` }}>
            <Space align="center">
              <span style={{ fontSize: 22, color: '#fa8c16' }}><ShopTwoTone /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>{t('channel.offlineCount', { n: offlineCount })}</div>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('channel.catOffline')}</div>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* 平台卡片网格 */}
      {data.length === 0 && !loading ? (
        <Empty description={t('channel.emptyPlatform')} style={{ padding: '60px 0' }} />
      ) : (
        <Row gutter={[16, 16]}>
          {data.map((platform) => {
            const meta = CATEGORY_META[platform.category] || CATEGORY_META.ONLINE;
            const shops = platform.children || [];
            return (
              <Col xs={24} md={12} xl={8} key={platform.id}>
                <Card
                  loading={loading}
                  styles={{ body: { paddingTop: 14 } }}
                  style={{
                    borderRadius: token.borderRadiusLG,
                    borderTop: `3px solid ${meta.color}`,
                    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                    height: '100%',
                  }}
                  title={
                    <Space>
                      <span style={{ color: meta.color, fontSize: 16 }}>{meta.icon}</span>
                      <span style={{ fontWeight: 600 }}>{platform.name}</span>
                      <Tag color={meta.color} style={{ marginInlineStart: 2 }}>{t(meta.label)}</Tag>
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
                  <div style={{ marginBottom: 10, fontSize: 12, color: token.colorTextSecondary }}>
                    {t('channel.shopCount', { n: shops.length })}
                    {platform.contact && (
                      <span style={{ marginInlineStart: 12 }}>
                        {t('channel.contact')}：{platform.contact}
                      </span>
                    )}
                  </div>

                  {shops.length === 0 ? (
                    <div style={{ padding: '14px 0', textAlign: 'center', fontSize: 12, color: token.colorTextQuaternary, border: `1px dashed ${token.colorBorderSecondary}`, borderRadius: token.borderRadius }}>
                      {t('channel.emptyShop')}
                    </div>
                  ) : (
                    <Space wrap size={[8, 8]}>
                      {shops.map((shop) => (
                        <Dropdown key={shop.id} menu={shopMenu(shop)} trigger={['click']}>
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              padding: '5px 12px', cursor: 'pointer',
                              background: token.colorFillQuaternary,
                              border: `1px solid ${token.colorBorderSecondary}`,
                              borderRadius: 999, fontSize: 13, color: token.colorText,
                              transition: 'all .2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = meta.color; e.currentTarget.style.color = meta.color; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = token.colorBorderSecondary; e.currentTarget.style.color = token.colorText; }}
                          >
                            <ShopOutlined style={{ fontSize: 12 }} />
                            {shop.name}
                            {shop.status === 'DISABLED' && <Badge status="default" />}
                          </div>
                        </Dropdown>
                      ))}
                    </Space>
                  )}

                  {platform.remark && (
                    <div style={{ marginTop: 12, fontSize: 12, color: token.colorTextTertiary, lineHeight: 1.5 }}>
                      {platform.remark}
                    </div>
                  )}
                </Card>
              </Col>
            );
          })}
        </Row>
      )}

      {/* 新建 / 编辑抽屉 */}
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
