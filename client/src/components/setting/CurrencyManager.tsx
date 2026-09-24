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
import { currencyApi, CurrencyRate, CurrencyInput } from '../../api/currency';
import { usePermission } from '../../hooks/usePermission';

export default function CurrencyManager() {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const { hasPerm } = usePermission();
  const canEdit = hasPerm('system:data:edit');

  const [data, setData] = useState<CurrencyRate[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CurrencyRate | null>(null);
  const [sortLoadingId, setSortLoadingId] = useState<string | null>(null);
  const [form] = Form.useForm<CurrencyInput>();

  const sorted = data;

  const fetchData = async () => {
    setLoading(true);
    try {
      const list = await currencyApi.getAll(keyword || undefined);
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

  const openModal = (record?: CurrencyRate) => {
    setEditing(record ?? null);
    form.setFieldsValue(
      record
        ? {
            code: record.code,
            name: record.name,
            symbol: record.symbol,
            isActive: record.isActive,
            sort: record.sort,
          }
        : { isActive: true, sort: 0 },
    );
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await currencyApi.update(editing.id, values);
      message.success(t('common.updateSuccess'));
    } else {
      await currencyApi.create(values);
      message.success(t('common.createSuccess'));
    }
    setModalOpen(false);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    await currencyApi.delete(id);
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
        await currencyApi.updateSort(reshuffled);
      } else {
        const min = Math.min(a.sort, target.sort);
        const max = Math.max(a.sort, target.sort);
        await currencyApi.updateSort([
          { id: a.id, sort: max },
          { id: target.id, sort: min },
        ]);
      }
      fetchData();
    } finally {
      setSortLoadingId(null);
    }
  };

  const toggleActive = async (record: CurrencyRate, checked: boolean) => {
    await currencyApi.update(record.id, { isActive: checked });
    message.success(t('common.updateSuccess'));
    fetchData();
  };

  const columns: ColumnsType<CurrencyRate> = [
    {
      title: t('common.sort'),
      width: 90,
      render: (_: unknown, _r: CurrencyRate, index: number) => (
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
    { title: t('currencyManager.code'), dataIndex: 'code' },
    { title: t('currencyManager.name'), dataIndex: 'name' },
    { title: t('currencyManager.symbol'), dataIndex: 'symbol', render: (v: string) => v || '—' },
    {
      title: t('common.status'),
      dataIndex: 'isActive',
      render: (v: boolean, r: CurrencyRate) =>
        canEdit ? (
          <Switch checked={v} onChange={(c) => toggleActive(r, c)} />
        ) : v ? (
          t('common.enabled')
        ) : (
          t('common.disabled')
        ),
    },
    {
      title: t('common.operation'),
      width: 140,
      render: (_: unknown, r: CurrencyRate) =>
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
      <div className="setting-card__desc">{t('currencyManager.settingHint')}</div>
      <div className="setting-toolbar">
        <Input.Search
          allowClear
          placeholder={t('currencyManager.searchPlaceholder')}
          style={{ width: 240 }}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {canEdit && (
          <Button type="primary" onClick={() => openModal()}>
            {t('currencyManager.add')}
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
        locale={{ emptyText: t('currencyManager.noData') }}
      />

      <Modal
        title={editing ? t('currencyManager.edit') : t('currencyManager.add')}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="code"
            label={t('currencyManager.code')}
            rules={[{ required: true, message: t('currencyManager.codeRequired') }]}
          >
            <Input placeholder={t('currencyManager.codePlaceholder')} disabled={!!editing} maxLength={10} />
          </Form.Item>
          <Form.Item
            name="name"
            label={t('currencyManager.name')}
            rules={[{ required: true, message: t('currencyManager.nameRequired') }]}
          >
            <Input placeholder={t('currencyManager.namePlaceholder')} maxLength={50} />
          </Form.Item>
          <Form.Item name="symbol" label={t('currencyManager.symbol')}>
            <Input placeholder={t('currencyManager.symbolPlaceholder')} maxLength={10} />
          </Form.Item>
          <Form.Item name="sort" label={t('common.sort')} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} placeholder={t('currencyManager.sortPlaceholder')} />
          </Form.Item>
          <Form.Item name="isActive" label={t('common.status')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
