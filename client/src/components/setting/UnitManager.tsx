import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { unitApi, Unit, UnitInput } from '../../api/unit';
import { usePermission } from '../../hooks/usePermission';

export default function UnitManager() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { hasPerm } = usePermission();
  const canEdit = hasPerm('system:data:edit');

  const [data, setData] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [sortLoadingId, setSortLoadingId] = useState<string | null>(null);
  const [form] = Form.useForm<UnitInput>();

  const sorted = data;

  const fetchData = async () => {
    setLoading(true);
    try {
      const list = await unitApi.getAll(keyword || undefined);
      setData(list);
    } catch {
      message.error(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword]);

  const openModal = (record?: Unit) => {
    setEditing(record ?? null);
    form.setFieldsValue(record ? { name: record.name, isActive: record.isActive, sort: record.sort } : { isActive: true, sort: 0 });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await unitApi.update(editing.id, values);
      message.success(t('common.updateSuccess'));
    } else {
      await unitApi.create(values);
      message.success(t('common.createSuccess'));
    }
    setModalOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await unitApi.delete(id);
    message.success(t('common.deleteSuccess'));
    fetchData();
  };

  const move = async (index: number, dir: -1 | 1) => {
    const target = sorted[index + dir];
    if (!target) return;
    const a = sorted[index];
    setSortLoadingId(a.id);
    try {
      if (a.sort === target.sort) {
        const min = Math.min(a.sort, target.sort);
        const reshuffled = sorted.map((item, i) => ({ id: item.id, sort: min + i }));
        await unitApi.updateSort(reshuffled);
      } else {
        const min = Math.min(a.sort, target.sort);
        const max = Math.max(a.sort, target.sort);
        await unitApi.updateSort([
          { id: a.id, sort: max },
          { id: target.id, sort: min },
        ]);
      }
      fetchData();
    } finally {
      setSortLoadingId(null);
    }
  };

  const toggleActive = async (record: Unit, checked: boolean) => {
    await unitApi.update(record.id, { isActive: checked });
    message.success(t('common.updateSuccess'));
    fetchData();
  };

  const columns: ColumnsType<Unit> = [
    {
      title: t('common.sort'),
      width: 90,
      render: (_: unknown, _r: Unit, index: number) => (
        <Space>
          <Button
            size="small"
            disabled={!canEdit || index === 0}
            loading={sortLoadingId === sorted[index].id}
            onClick={() => move(index, -1)}
          >
            ↑
          </Button>
          <Button
            size="small"
            disabled={!canEdit || index === sorted.length - 1}
            loading={sortLoadingId === sorted[index].id}
            onClick={() => move(index, 1)}
          >
            ↓
          </Button>
        </Space>
      ),
    },
    { title: t('unitManager.name'), dataIndex: 'name' },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      render: (v: boolean, r: Unit) =>
        canEdit ? (
          <Switch checked={v} onChange={(c) => toggleActive(r, c)} />
        ) : v ? (
          t('common.enabled')
        ) : (
          t('common.disabled')
        ),
    },
    {
      title: t('common.actions'),
      width: 140,
      render: (_: unknown, r: Unit) =>
        canEdit ? (
          <Space>
            <Button size="small" type="link" onClick={() => openModal(r)}>
              {t('common.edit')}
            </Button>
            <Popconfirm title={t('common.confirmDelete')} onConfirm={() => handleDelete(r.id)}>
              <Button size="small" type="link" danger>
                {t('common.delete')}
              </Button>
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <div className="setting-card">
      <div className="setting-card__desc">{t('unitManager.settingHint')}</div>
      <div className="setting-toolbar">
        <Input.Search
          allowClear
          placeholder={t('unitManager.searchPlaceholder')}
          style={{ width: 240 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {canEdit && (
          <Button type="primary" onClick={() => openModal()}>
            {t('unitManager.add')}
          </Button>
        )}
      </div>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: t('unitManager.noData') }}
      />

      <Modal
        title={editing ? t('unitManager.edit') : t('unitManager.add')}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="name"
            label={t('unitManager.name')}
            rules={[{ required: true, message: t('unitManager.nameRequired') }]}
          >
            <Input placeholder={t('unitManager.namePlaceholder')} maxLength={20} />
          </Form.Item>
          <Form.Item name="sort" label={t('common.sort')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} placeholder={t('unitManager.sortPlaceholder')} />
          </Form.Item>
          <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
