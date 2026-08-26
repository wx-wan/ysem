import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Tag, Select, DatePicker, Input, Space, Button, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../api/request';
import DiffTags, { DiffItem } from '../components/common/DiffTags';
import dayjs from 'dayjs';
import PageSkeleton from '../components/PageSkeleton';

interface OpLog {
  id: string;
  userId: string;
  username: string;
  realName: string | null;
  action: string;
  module: string;
  target: string | null;
  detail: string | null;
  diff: string | DiffItem[] | null;
  createdAt: string;
}

const MODULE_LABELS: Record<string, string> = {
  product: '产品', 'product-group': '产品组', 'sample-apply': '打样',
  quote: '报价',
  customer: '客户', sales: '商机', order: '订单',
  user: '用户', certificate: '资质',
  lead: '线索',
};
// 动作中文映射
const ACTION_LABELS: Record<string, string> = {
  // 通用
  CREATE: '创建',
  UPDATE: '修改',
  DELETE: '删除',
  STATUS: '状态变更',
  // 客户
  CLAIM: '认领',
  RELEASE: '释放',
  TRANSFER: '转移',
  KEY_TOGGLE: '重点客户切换',
  INTENT_CHANGE: '意向变更',
  // 销售/商机 pipeline
  PIPELINE_CREATED: '创建商机',
  PIPELINE_UPDATED: '修改商机',
  PIPELINE_DELETED: '删除商机',
  PIPELINE_STAGE_CHANGE: '商机阶段变更',
  STAGE_CHANGE: '阶段变更',
  STAGE: '阶段变更',
  // 单据
  QUOTE_CREATED: '新增报价单',
  SAMPLE_CREATED: '新增打样单',
  ORDER_CREATED: '新增订单',
  ORDER_UPDATED: '修改订单',
  ORDER_SUBMITTED: '提交审批',
  ORDER_APPROVED: '审批通过',
  ORDER_REJECTED: '审批驳回',
  ORDER_DELETED: '删除订单',
  // 其他
  LOGIN: '登录',
  AUTH: '授权',
  EXPORT: '导出',
  IMPORT: '导入',
  // 兼容旧数据
  CREATED: '创建',
  UPDATED: '修改',
  TRANSFERRED: '转移',
};
const ACTION_COLORS: Record<string, string> = {
  CREATE: 'green', CREATED: 'green',
  UPDATE: 'blue', UPDATED: 'blue',
  DELETE: 'red',
  STATUS: 'orange',
  CLAIM: 'cyan',
  RELEASE: 'default',
  TRANSFER: 'purple', TRANSFERRED: 'purple',
  LOGIN: 'default',
  AUTH: 'gold',
  EXPORT: 'geekblue',
  IMPORT: 'processing',
  PIPELINE_CREATED: 'green',
  PIPELINE_UPDATED: 'blue',
  PIPELINE_DELETED: 'red',
  PIPELINE_STAGE_CHANGE: 'purple',
  STAGE_CHANGE: 'purple',
  STAGE: 'purple',
  KEY_TOGGLE: 'gold',
  INTENT_CHANGE: 'gold',
};

export default function OperationLogs() {
  const [data, setData] = useState<OpLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<{
    module: string; action: string; keyword: string;
    start: string; end: string;
  }>({ module: '', action: '', keyword: '', start: '', end: '' });

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (filters.module) params.set('module', filters.module);
      if (filters.action) params.set('action', filters.action);
      if (filters.keyword) params.set('keyword', filters.keyword);
      if (filters.start) params.set('start', filters.start);
      if (filters.end) params.set('end', filters.end);
      const res = await request.get(`/operations?${params.toString()}`);
      const d = res.data.data;
      setData(d.list || []);
      setTotal(d.total || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, [page, pageSize]);

  const columns: ColumnsType<OpLog> = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 160,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD HH:mm:ss'),
    },
    {
      title: '操作人',
      key: 'operator',
      width: 160,
      render: (_, r) => (
        <div>
          <div style={{ fontWeight: 600, lineHeight: 1.5 }}>{r.realName || r.username}</div>
          {r.realName && <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.5 }}>@{r.username}</div>}
        </div>
      ),
    },
    {
      title: '模块',
      dataIndex: 'module',
      width: 90,
      render: (v: string) => <Tag>{MODULE_LABELS[v] || v}</Tag>,
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 130,
      render: (v: string) => (
        <Tag color={ACTION_COLORS[v] || 'default'} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {ACTION_LABELS[v] || v}
        </Tag>
      ),
    },
    {
      title: '对象',
      dataIndex: 'target',
      width: 260,
      ellipsis: true,
      render: (v: string | null) => (v ? <span title={v} style={{ wordBreak: 'break-all' }}>{v}</span> : '—'),
    },
    {
      title: '操作内容与变更',
      key: 'detail',
      render: (_, r) => (
        <div>
          <div style={{ color: '#595959' }}>{r.detail || ACTION_LABELS[r.action] || ''}</div>
          <DiffTags diff={r.diff} max={4} />
        </div>
      ),
    },
  ], []);

  return (
    <div className="pt-container">
      <div className="page-header">
        <div>
          <h2>操作日志</h2>
          <p className="page-header-desc">全系统操作留痕：操作人、时间、动作与字段级变更记录</p>
        </div>
      </div>

      <Card style={{ borderRadius: 12, marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="模块"
            style={{ width: 140 }}
            value={filters.module || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, module: v || '' }))}
            options={Object.entries(MODULE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          />
          <Select
            allowClear
            placeholder="动作"
            style={{ width: 140 }}
            value={filters.action || undefined}
            onChange={(v) => setFilters((f) => ({ ...f, action: v || '' }))}
            options={Object.entries(ACTION_LABELS).map(([v, l]) => ({ value: v, label: l }))}
          />
          <Input
            allowClear
            placeholder="操作人 / 对象关键字"
            prefix={<SearchOutlined />}
            style={{ width: 220 }}
            value={filters.keyword}
            onChange={(e) => setFilters((f) => ({ ...f, keyword: e.target.value }))}
            onPressEnter={fetchLogs}
          />
          <DatePicker
            placeholder="开始日期"
            value={filters.start ? dayjs(filters.start) : null}
            onChange={(d) => setFilters((f) => ({ ...f, start: d ? d.format('YYYY-MM-DD') : '' }))}
          />
          <DatePicker
            placeholder="结束日期"
            value={filters.end ? dayjs(filters.end) : null}
            onChange={(d) => setFilters((f) => ({ ...f, end: d ? d.format('YYYY-MM-DD') : '' }))}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={fetchLogs}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={() => { setFilters({ module: '', action: '', keyword: '', start: '', end: '' }); setPage(1); fetchLogs(); }}>重置</Button>
        </Space>
      </Card>

      {loading && data.length === 0 ? (
        <PageSkeleton rows={8} />
      ) : (
        <Card style={{ borderRadius: 12 }}>
          <Table
            rowKey="id"
            loading={loading && data.length > 0}
            columns={columns}
            dataSource={data}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: true,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            }}
          />
        </Card>
      )}
    </div>
  );
}
