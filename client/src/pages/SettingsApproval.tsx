import React, { useEffect, useState } from 'react';
import { Card, Table, Select, Switch, Button, Space, Typography, App } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { userApi, type User } from '../api/users';
import {
  APPROVAL_BIZ_TYPES,
  APPROVAL_BIZ_TYPE_LABEL,
  approvalConfigApi,
  type ApprovalBizType,
} from '../api/approvals';

/**
 * 审批配置页（V1.0 ApprovalConfig）
 *
 * 数据源：/api/approval-configs（V1.0 Approval Runtime）。
 * 本页已脱离 legacy 审批配置端点。
 *
 * 关键行为：
 *  - GET 列表**不补齐**缺失 bizType → 页面恒渲染全部 8 个业务类型（缺失者用默认值）；
 *  - V1.0 无 upsert：本地不存在配置 → POST；已存在 → PUT；
 *  - approverIds 写入要求 array、≥1、不可重复 → 提交前去重 + 空值拦截（不发请求）；
 *  - 页面为**纯配置页**：无审批动作（submit / approve / reject / withdraw），不涉及任何业务状态。
 */

const { Title, Text } = Typography;

/** 后端 approverIds / approverNames 为 JSON 字符串（names 可能为 null）→ string[]；异常数据降级为 [] */
function parseStringArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
  } catch {
    return [];
  }
}

interface Row {
  bizType: ApprovalBizType;
  enabled: boolean;
  approverIds: string[];
  approverNames: string[];
}

/** 默认行：缺失配置 → 停用 + 空审批人（首次打开也必须稳定显示 8 行） */
const buildDefaultRows = (): Row[] =>
  APPROVAL_BIZ_TYPES.map((bizType) => ({
    bizType,
    enabled: false,
    approverIds: [],
    approverNames: [],
  }));

export default function SettingsApprovalPage() {
  const { message: msg } = App.useApp();
  const [users, setUsers] = useState<User[]>([]);
  const [rows, setRows] = useState<Row[]>(buildDefaultRows);
  /** 服务端已存在配置的 bizType（决定 POST / PUT） */
  const [existing, setExisting] = useState<Set<ApprovalBizType>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 审批人 id → 姓名（以当前用户列表为权威，避免冗余姓名漂移） */
  const namesOf = (ids: string[]): string[] =>
    ids
      .map((id) => {
        const u = users.find((x) => x.id === id);
        return u?.realName || u?.username || '';
      })
      .filter((n) => n.length > 0);

  useEffect(() => {
    userApi
      .list({ pageSize: 200 })
      .then((r) => setUsers(r.data?.data?.list || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const res = await approvalConfigApi.list();
        const list = res.data?.data || [];
        const map = new Map(list.map((c) => [c.bizType, c]));
        setExisting(new Set(map.keys()));
        setRows(
          APPROVAL_BIZ_TYPES.map((bizType) => {
            const cfg = map.get(bizType);
            if (!cfg) {
              return { bizType, enabled: false, approverIds: [], approverNames: [] };
            }
            return {
              bizType,
              enabled: cfg.enabled,
              approverIds: parseStringArray(cfg.approverIds),
              approverNames: parseStringArray(cfg.approverNames),
            };
          }),
        );
      } catch {
        // 拉取失败时保留 8 行默认值，错误提示由请求拦截器统一处理
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const updateRow = (bizType: ApprovalBizType, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.bizType === bizType ? { ...r, ...patch } : r)));

  const handleSave = async () => {
    setSaving(true);
    const succeeded: ApprovalBizType[] = [];
    const failed: { bizType: ApprovalBizType; reason: string }[] = [];
    const nextExisting = new Set(existing);

    for (const row of rows) {
      // 后端要求 array + min(1) + 不可重复 → 先规范化，再空值拦截（不发请求）
      const approverIds = Array.from(new Set(row.approverIds.filter((id) => id.length > 0)));
      if (approverIds.length === 0) {
        failed.push({ bizType: row.bizType, reason: '请至少选择一名审批人' });
        continue;
      }
      try {
        const payload = {
          approverIds,
          approverNames: namesOf(approverIds),
          enabled: row.enabled,
        };
        if (nextExisting.has(row.bizType)) {
          await approvalConfigApi.update(row.bizType, payload);
        } else {
          await approvalConfigApi.create({ bizType: row.bizType, ...payload });
          nextExisting.add(row.bizType);
        }
        succeeded.push(row.bizType);
      } catch (e: any) {
        failed.push({
          bizType: row.bizType,
          reason: e?.response?.data?.message || '保存失败',
        });
      }
    }

    setExisting(nextExisting);
    setSaving(false);

    const failedText = failed
      .map((f) => `${APPROVAL_BIZ_TYPE_LABEL[f.bizType]}（${f.reason}）`)
      .join('；');

    if (failed.length === 0) {
      msg.success(`审批配置已保存（${succeeded.length} 项）`);
    } else if (succeeded.length === 0) {
      msg.error(`保存失败：${failedText}`);
    } else {
      msg.warning(`已保存 ${succeeded.length} 项；未保存：${failedText}`);
    }
  };

  const columns: ColumnsType<Row> = [
    {
      title: '单据类型',
      dataIndex: 'bizType',
      width: 180,
      render: (b: ApprovalBizType) => APPROVAL_BIZ_TYPE_LABEL[b] || b,
    },
    {
      title: '启用审批',
      dataIndex: 'enabled',
      width: 110,
      render: (_: boolean, row: Row) => (
        <Switch checked={row.enabled} onChange={(v) => updateRow(row.bizType, { enabled: v })} />
      ),
    },
    {
      title: '审批人',
      dataIndex: 'approverIds',
      render: (_: string[], row: Row) => (
        <Select
          mode="multiple"
          allowClear
          style={{ width: 360 }}
          placeholder="选择审批人（至少一名）"
          optionFilterProp="label"
          value={row.approverIds}
          onChange={(v: string[]) =>
            updateRow(row.bizType, { approverIds: v, approverNames: namesOf(v) })
          }
          options={users.map((u) => ({ label: u.realName || u.username, value: u.id }))}
        />
      ),
    },
  ];

  return (
    <div>
      <Title level={4}>审批管理</Title>
      <Text type="secondary">
        为 8 类业务单据分别配置审批人。启用后，对应单据提交审批时由所配置的审批人处理；不启用则视为不启用审批流程。每类单据至少选择一名审批人方可保存。
      </Text>
      <Card style={{ marginTop: 16 }}>
        <Table
          rowKey="bizType"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
        />
        <Space style={{ marginTop: 16 }}>
          <Button type="primary" loading={saving} onClick={handleSave}>
            保存配置
          </Button>
        </Space>
      </Card>
    </div>
  );
}
