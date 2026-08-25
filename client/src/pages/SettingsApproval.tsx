import React, { useEffect, useState } from 'react';
import { Card, Table, Select, Switch, Button, Space, Typography, message, App } from 'antd';
import { userApi } from '../api/users';
import { approvalApi } from '../api/approvals';

const { Title, Text } = Typography;

const TYPES = [
  { label: '报价单审批', value: 'QUOTE' },
  { label: '打样单审批', value: 'SAMPLE' },
  { label: '正式订单审批', value: 'ORDER' },
];

interface Row {
  type: string;
  enabled: boolean;
  approverIds: string[];
  approverNames: (string | null)[];
}

export default function SettingsApprovalPage() {
  const { message: msg } = App.useApp();
  const [users, setUsers] = useState<{ id: string; realName?: string; username: string }[]>([]);
  const [rows, setRows] = useState<Row[]>(
    TYPES.map((t) => ({ type: t.value, enabled: false, approverIds: [], approverNames: [] }))
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    userApi.list({ pageSize: 200 }).then((r) => setUsers(r.data?.data?.list || [])).catch(() => {});
    approvalApi.list().then((r) => {
      const list: Row[] = r.data?.data || [];
      setRows((prev) =>
        TYPES.map((t) => {
          const cfg = list.find((c) => c.type === t.value);
          const ids: string[] = cfg?.approverIds ? JSON.parse(cfg.approverIds) : [];
          const names: (string | null)[] = cfg?.approverNames ? JSON.parse(cfg.approverNames) : [];
          return { type: t.value, enabled: cfg ? cfg.enabled : false, approverIds: ids, approverNames: names };
        })
      );
    }).catch(() => {});
  }, []);

  const updateRow = (idx: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const r of rows) {
        const names = r.approverIds.map((id) => users.find((u) => u.id === id)?.realName || users.find((u) => u.id === id)?.username || null);
        await approvalApi.save({ type: r.type as any, approverIds: r.approverIds, approverNames: names, enabled: r.enabled });
      }
      msg.success('审批配置已保存');
    } catch (e: any) {
      msg.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const columns = [
    { title: '单据类型', dataIndex: 'type', render: (t: string) => TYPES.find((x) => x.value === t)?.label },
    {
      title: '启用审批',
      dataIndex: 'enabled',
      render: (_: boolean, _r: Row, idx: number) => (
        <Switch checked={rows[idx].enabled} onChange={(v) => updateRow(idx, { enabled: v })} />
      ),
    },
    {
      title: '审批人',
      dataIndex: 'approverIds',
      render: (_: any, _r: Row, idx: number) => (
        <Select
          mode="multiple"
          allowClear
          style={{ width: 360 }}
          placeholder="选择审批人"
          optionFilterProp="label"
          value={rows[idx].approverIds}
          onChange={(v) => updateRow(idx, { approverIds: v })}
          options={users.map((u) => ({ label: u.realName || u.username, value: u.id }))}
        />
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>审批管理</Title>
      <Text type="secondary">为「报价单 / 打样单 / 正式订单」分别配置审批人。报价单、打样单提交后需对应审批人通过方可生效；正式订单可选配置。</Text>
      <Card style={{ marginTop: 16 }}>
        <Table rowKey="type" dataSource={rows} columns={columns} pagination={false} />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" loading={saving} onClick={handleSave}>保存配置</Button>
        </Space>
      </Card>
    </div>
  );
}
