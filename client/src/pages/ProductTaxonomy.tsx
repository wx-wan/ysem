import { useEffect, useState } from 'react';
import {
  Table, Button, Space, Tag, Modal, Form, Input, InputNumber, Select,
  Popconfirm, App, Tabs, Card,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { usePermission } from '../hooks/usePermission';
import { taxonomyApi, ProductCraft, ProductAudience, ProductCategory } from '../api/products';

type TabKey = 'craft' | 'audience' | 'category';

const TAB_LABELS: Record<TabKey, string> = {
  craft: '一级工艺',
  audience: '二级受众',
  category: '三级品类',
};

export default function ProductTaxonomy() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();

  const [activeTab, setActiveTab] = useState<TabKey>('craft');

  // 数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, any> | null>(null);
  const [form] = Form.useForm();

  const fetchData = async () => {
    try {
      const [c, a, cat] = await Promise.all([
        taxonomyApi.getCrafts(),
        taxonomyApi.getAudiences(),
        taxonomyApi.getCategories(),
      ]);
      if (c.data.code === 200 || c.data.code === 0) setCrafts(c.data.data);
      if (a.data.code === 200 || a.data.code === 0) setAudiences(a.data.data);
      if (cat.data.code === 200 || cat.data.code === 0) setCategories(cat.data.data);
    } catch { message.error('加载失败'); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleAdd = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 1, sort: 0 });
    setModalOpen(true);
  };

  const handleEdit = (record: Record<string, any>) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue({ ...record });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const api = ACTIVE_API.delete;
      await api(id);
      message.success('删除成功');
      fetchData();
    } catch { message.error('删除失败'); }
  };

  // 排序：上移 / 下移（重排后统一写回 sort = 1..N）
  const handleMove = async (index: number, dir: -1 | 1) => {
    const list = ACTIVE_API.list;
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    try {
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      await Promise.all(next.map((item, i) => ACTIVE_API.update(item.id, { sort: i + 1 })));
      message.success('排序已更新');
      fetchData();
    } catch { message.error('排序失败'); }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await ACTIVE_API.update(editing.id, values);
        message.success('更新成功');
      } else {
        await ACTIVE_API.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch { /* validation */ }
  };

  // 当前 tab 对应的 API
  const ACTIVE_API = (() => {
    switch (activeTab) {
      case 'craft': return { list: crafts, create: taxonomyApi.createCraft, update: (id: string, d: any) => taxonomyApi.updateCraft(id, d), delete: taxonomyApi.deleteCraft };
      case 'audience': return { list: audiences, create: taxonomyApi.createAudience, update: (id: string, d: any) => taxonomyApi.updateAudience(id, d), delete: taxonomyApi.deleteAudience };
      case 'category': return { list: categories, create: taxonomyApi.createCategory, update: (id: string, d: any) => taxonomyApi.updateCategory(id, d), delete: taxonomyApi.deleteCategory };
    }
  })();

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '排序', dataIndex: 'sort', key: 'sort', width: 80 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 80,
      render: (s: number) => (
        <Tag color={s === 1 ? 'success' : 'default'} variant="filled">{s === 1 ? '启用' : '停用'}</Tag>
      ),
    },
    {
      title: '关联', key: 'rel', width: 200,
      render: (_: unknown, r: any) => {
        if (activeTab === 'audience' && r.categories) {
          return <span>{r.categories.map((c: any) => c.name).join(', ')}</span>;
        }
        if (activeTab === 'category' && r.audience) {
          return <Tag>{r.audience.name}</Tag>;
        }
        return '-';
      },
    },
    {
      title: t('common.operation') || '操作', key: 'action', width: 170, fixed: 'right' as const,
      render: (_: unknown, record: any, index: number) => (
        <span className="pm-actions">
          {hasPerm('product:taxonomy:update') && (
            <>
              <Button type="text" title="上移" icon={<ArrowUpOutlined />}
                disabled={index === 0} onClick={() => handleMove(index, -1)} />
              <Button type="text" title="下移" icon={<ArrowDownOutlined />}
                disabled={index === ACTIVE_API.list.length - 1} onClick={() => handleMove(index, 1)} />
              <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
            </>
          )}
          {hasPerm('product:taxonomy:delete') && (
            <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </span>
      ),
    },
  ];

  const renderModalFields = () => {
    if (activeTab === 'category') {
      return (
        <>
          <Form.Item name="name" label="品类名称" rules={[{ required: true, message: '请输入' }]}>
            <Input placeholder="输入品类名称" />
          </Form.Item>
          <Form.Item name="audienceId" label="所属受众" rules={[{ required: true, message: '请选择受众' }]}>
            <Select placeholder="选择受众" options={audiences.map((a) => ({ label: a.name, value: a.id }))} />
          </Form.Item>
        </>
      );
    }
    return (
      <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入' }]}>
        <Input placeholder="输入名称" />
      </Form.Item>
    );
  };

  return (
    <div className="pt-container">
      <div className="page-header">
        <div>
          <h2>{t('taxonomy.title') || '产品管理'}</h2>
          <p className="page-header-desc">维护产品的三级分类体系：工艺、受众、品类</p>
        </div>
      </div>

      <Card className="pt-card" styles={{ body: { padding: 0 } }}>
        <Tabs className="pt-tabs" activeKey={activeTab} onChange={(k) => setActiveTab(k as TabKey)}
          items={(['craft', 'audience', 'category'] as TabKey[]).map((k) => ({
            key: k, label: TAB_LABELS[k],
          }))} />

        <div className="pt-toolbar">
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          {hasPerm('product:taxonomy:create') && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增</Button>
          )}
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={ACTIVE_API.list}
          loading={false}
          pagination={false}
        />
      </Card>

      <Modal
        title={editing ? `编辑${TAB_LABELS[activeTab]}` : `新增${TAB_LABELS[activeTab]}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {renderModalFields()}
          <Form.Item name="sort" label="排序">
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue={1}>
            <Select
              options={[{ label: '启用', value: 1 }, { label: '停用', value: 0 }]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
