import { useEffect, useState, useMemo, type ReactNode } from 'react';
import {
  Table, Button, Space, Tag, App, Popconfirm, Input, Row, Col, Card,
  Statistic, Tooltip, Typography,
} from 'antd';
import * as AntIcons from '@ant-design/icons';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, ApiOutlined,
  AppstoreOutlined, ControlOutlined, DatabaseOutlined, SearchOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import request from '../api/request';
import PermFormModal from '../components/perm/PermFormModal';
import { usePermission } from '../hooks/usePermission';

interface PermRecord {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId: string | null;
  sort: number;
  path: string;
  icon: string;
  children?: PermRecord[];
}

const permApi = {
  create: (data: any) => request.post('/permissions', data),
  update: (id: string, data: any) => request.put(`/permissions/${id}`, data),
};

// 类型元信息：颜色 + 图标 + 文案 key
const TYPE_META: Record<string, { color: string; icon: ReactNode; textKey: string }> = {
  MENU: { color: 'blue', icon: <AppstoreOutlined />, textKey: 'perm.typeMenu' },
  BUTTON: { color: 'green', icon: <ControlOutlined />, textKey: 'perm.typeButton' },
  API: { color: 'orange', icon: <ApiOutlined />, textKey: 'perm.typeApi' },
};

// 递归统计：总数与各类型数量
const countByType = (perms: PermRecord[]) => {
  const counter: Record<string, number> = { total: 0, MENU: 0, BUTTON: 0, API: 0 };
  const walk = (list: PermRecord[]) => {
    list.forEach((n) => {
      counter.total += 1;
      counter[n.type] = (counter[n.type] || 0) + 1;
      if (n.children?.length) walk(n.children);
    });
  };
  walk(perms);
  return counter;
};

// 递归收集全部节点（用于上级菜单下拉与搜索过滤）
const collectAll = (perms: PermRecord[]): PermRecord[] => {
  const out: PermRecord[] = [];
  const walk = (list: PermRecord[]) => {
    list.forEach((n) => {
      out.push(n);
      if (n.children?.length) walk(n.children);
    });
  };
  walk(perms);
  return out;
};

// 按关键字过滤树：节点自身或子树命中则保留
const filterTree = (perms: PermRecord[], keyword: string): PermRecord[] => {
  if (!keyword) return perms;
  const lower = keyword.toLowerCase();
  return perms
    .map((n) => {
      const children = n.children ? filterTree(n.children, keyword) : [];
      const selfMatch =
        n.name.toLowerCase().includes(lower) || n.code.toLowerCase().includes(lower);
      if (selfMatch) return { ...n, children: n.children };
      if (children.length) return { ...n, children };
      return null;
    })
    .filter(Boolean) as PermRecord[];
};

export default function PermPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { hasPerm } = usePermission();
  const [permissions, setPermissions] = useState<PermRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerm, setEditingPerm] = useState<PermRecord | null>(null);
  const [parentId, setParentId] = useState<string | undefined>(undefined);
  const [defaultType, setDefaultType] = useState<string>('MENU');

  const fetchPerms = async () => {
    setLoading(true);
    try {
      const res = await request.get('/permissions/tree');
      setPermissions(res.data.data || []);
    } catch { /* handled */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchPerms(); }, []);

  const handleAdd = (pid?: string) => {
    setEditingPerm(null);
    setParentId(pid);
    setDefaultType(pid ? 'BUTTON' : 'MENU');
    setModalOpen(true);
  };

  const handleEdit = (record: PermRecord) => {
    setEditingPerm(record);
    setParentId(undefined);
    setDefaultType('MENU');
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/permissions/${id}`);
      message.success(t('perm.deleteSuccess'));
      fetchPerms();
    } catch { /* handled */ }
  };

  const handleModalClose = () => {
    setModalOpen(false);
    setEditingPerm(null);
    setParentId(undefined);
  };

  // 图标名动态渲染（icon 字段存的是 @ant-design/icons 组件名）
  const renderIcon = (name: string) => {
    if (!name) return <span style={{ color: '#c0c4cc' }}>-</span>;
    const Icon = (AntIcons as Record<string, any>)[name];
    return Icon ? (
      <Icon style={{ fontSize: 16, color: '#4a5568' }} />
    ) : (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{name}</Typography.Text>
    );
  };

  const counts = useMemo(() => countByType(permissions), [permissions]);
  const filtered = useMemo(() => filterTree(permissions, keyword), [permissions, keyword]);

  const parentOptions = useMemo(() => collectAll(permissions)
    .filter((p) => p.type === 'MENU')
    .map((p) => ({ label: `${p.name} (${p.code})`, value: p.id })), [permissions]);

  const columns: ColumnsType<PermRecord> = useMemo(() => [
    {
      title: t('perm.name'), dataIndex: 'name', width: 180,
      render: (v: string, record) => (
        <Space size={4}>
          <span>{v}</span>
          {record.children?.length ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ({record.children.length})
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: t('perm.code'), dataIndex: 'code', width: 210,
      render: (v: string) => <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text>,
    },
    {
      title: t('perm.type'), dataIndex: 'type', width: 90,
      render: (tp: string) => {
        const info = TYPE_META[tp];
        if (!info) return <Tag>{tp}</Tag>;
        return (
          <Tag color={info.color} icon={info.icon} style={{ marginInlineEnd: 0 }}>
            {t(info.textKey)}
          </Tag>
        );
      },
    },
    {
      title: t('perm.path'), dataIndex: 'path', width: 170,
      render: (v: string) =>
        v ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v}</Typography.Text>
          : <span style={{ color: '#c0c4cc' }}>-</span>,
    },
    { title: t('perm.icon'), dataIndex: 'icon', width: 80, render: renderIcon },
    {
      title: t('perm.sort'), dataIndex: 'sort', width: 70, align: 'center',
      render: (v: number) => <Typography.Text type="secondary">{v}</Typography.Text>,
    },
    {
      title: t('common.operation'), width: 120, fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          {hasPerm('system:perm:edit') && (
            <Tooltip title={t('perm.addChild')}>
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => handleAdd(record.id)} />
            </Tooltip>
          )}
          {hasPerm('system:perm:edit') && (
            <Tooltip title={t('common.edit')}>
              <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
            </Tooltip>
          )}
          {hasPerm('system:perm:delete') && (
            <Popconfirm title={t('perm.deleteConfirm')} onConfirm={() => handleDelete(record.id)}>
              <Tooltip title={t('common.delete')}>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [t, hasPerm]);

  return (
    <>
      <div className="page-header"><h2>{t('perm.title')}</h2></div>
      <div className="search-bar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('perm.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 260 }}
        />
        <Button icon={<ReloadOutlined />} onClick={fetchPerms}>{t('common.refresh')}</Button>
        {hasPerm('system:perm:create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAdd()}>{t('perm.addTitle')}</Button>
        )}
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('perm.total')} value={counts.total} prefix={<DatabaseOutlined style={{ color: '#1677ff' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('perm.typeMenu')} value={counts.MENU} prefix={<AppstoreOutlined style={{ color: '#1677ff' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('perm.typeButton')} value={counts.BUTTON} prefix={<ControlOutlined style={{ color: '#52c41a' }} />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small">
            <Statistic title={t('perm.typeApi')} value={counts.API} prefix={<ApiOutlined style={{ color: '#fa8c16' }} />} />
          </Card>
        </Col>
      </Row>

      <div className="table-container">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={false}
          defaultExpandAllRows
          size="middle"
        />
      </div>

      <PermFormModal
        open={modalOpen}
        editingPerm={editingPerm}
        parentOptions={parentOptions}
        onClose={handleModalClose}
        onSuccess={fetchPerms}
        api={permApi}
        t={t}
        initialParentId={parentId}
        initialType={defaultType}
      />
    </>
  );
}
