import { useMemo } from 'react';
import { Button, Popconfirm, Space, Table, Tag, Tooltip } from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from 'react-i18next';
import { type Lead, type LeadSource, type LeadStatus } from '../../api/lead';
import { useUserStore } from '../../stores/useUserStore';
import { SOURCE_META, STATUS_META } from './constants';

interface Props {
  dataSource: Lead[];
  loading: boolean;
  selectedKeys: string[];
  onSelectionChange: (keys: string[]) => void;
  isAdmin: boolean;
  onEdit: (record: Lead) => void;
  onRemove: (id: string) => void;
  onChangeStatus: (id: string, status: LeadStatus) => void;
  onConvert: (record: Lead) => void;
}

/** 线索列表表格（含行选择 / 操作列） */
export default function LeadTable({
  dataSource,
  loading,
  selectedKeys,
  onSelectionChange,
  isAdmin,
  onEdit,
  onRemove,
  onChangeStatus,
  onConvert,
}: Props) {
  const { t } = useTranslation();
  const userOptions = useUserStore((s) => s.users);

  const userNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    userOptions.forEach((u) => {
      m[u.id] = u.realName || u.username;
    });
    return m;
  }, [userOptions]);

  const columns: ColumnsType<Lead> = useMemo(
    () => [
      {
        title: t('lead.name'),
        dataIndex: 'leadName',
        width: 200,
        render: (v?: string, r?: Lead) =>
          v ? (
            <a
              style={{ color: '#1677ff' }}
              onClick={() => r && onEdit(r)}
              title={t('common.detail')}
            >
              {v}
            </a>
          ) : (
            '-'
          ),
      },
      {
        title: t('lead.customer'),
        width: 160,
        render: (_: unknown, r: Lead) => {
          const name = r.customer?.companyName || r.companyName || '';
          const contact = r.customer?.contactName || r.contactName || '';
          if (!name && !contact) return '-';
          return (
            <Space size={4}>
              {name && <span style={{ color: 'rgba(0,0,0,0.88)', fontWeight: 500 }}>{name}</span>}
              {contact && <span style={{ color: 'rgba(0,0,0,0.45)' }}>{contact}</span>}
            </Space>
          );
        },
      },
      {
        title: t('lead.channel'),
        dataIndex: 'sourceChannel',
        width: 180,
        render: (v?: string) => {
          if (!v) return '-';
          const parts = v.split(' / ');
          return parts.length > 1 ? `${parts[0]} / ${parts[1]}` : v;
        },
      },
      {
        title: t('lead.source'),
        dataIndex: 'source',
        width: 100,
        render: (v?: LeadSource) => {
          const meta = v ? SOURCE_META[v] : undefined;
          return meta ? <Tag color={meta.color}>{t(meta.label)}</Tag> : '-';
        },
      },
      {
        title: t('lead.status'),
        dataIndex: 'status',
        width: 110,
        render: (v?: LeadStatus) => {
          const meta = v ? STATUS_META[v] : undefined;
          return meta ? <Tag color={meta.color}>{t(meta.label)}</Tag> : '-';
        },
      },
      {
        title: t('lead.assignee'),
        dataIndex: 'assignedTo',
        width: 100,
        render: (v?: string) => (v ? userNameMap[v] || '-' : '-'),
      },
      {
        title: t('lead.createdAt'),
        dataIndex: 'createdAt',
        width: 120,
        render: (v?: string) => (v ? v.slice(0, 10) : '-'),
      },
      {
        title: t('common.operation'),
        key: 'action',
        fixed: 'right',
        width: 200,
        render: (_: unknown, r: Lead) => {
          const isInvalid = r.status === 'INVALID';
          return (
            <Space size={2}>
              {/* 确认：转为商机（仅无效状态禁用，与详情弹窗逻辑一致） */}
              <Tooltip title={t('lead.confirmLead')}>
                <Button
                  type="link"
                  size="small"
                  icon={<AuditOutlined />}
                  disabled={isInvalid}
                  onClick={() => onConvert(r)}
                />
              </Tooltip>
              {/* 有效：无效 → 有效（二次确认防止误触） */}
              <Popconfirm title={t('lead.confirmSetValid')} onConfirm={() => onChangeStatus(r.id, 'VALID')}>
                <Button
                  type="link"
                  size="small"
                  icon={<CheckCircleOutlined />}
                  disabled={!isInvalid}
                />
              </Popconfirm>
              {/* 无效：新建/有效 → 无效 */}
              <Tooltip title={t('lead.invalid')}>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<StopOutlined />}
                  disabled={isInvalid}
                  onClick={() => onChangeStatus(r.id, 'INVALID')}
                />
              </Tooltip>
              {isAdmin && (
                <Popconfirm title={t('common.confirmDelete')} onConfirm={() => onRemove(r.id)}>
                  <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              )}
            </Space>
          );
        },
      },
    ],
    [t, isAdmin, userNameMap, onEdit, onRemove, onChangeStatus],
  );

  return (
    <Table<Lead>
      rowKey="id"
      columns={columns}
      dataSource={dataSource}
      loading={loading}
      size="middle"
      rowSelection={{
        selectedRowKeys: selectedKeys,
        onChange: (keys) => onSelectionChange(keys as string[]),
      }}
      scroll={{ x: 1000 }}
      pagination={false}
    />
  );
}
