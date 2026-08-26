import { useMemo } from 'react';
import { Button, Input, Popconfirm, Select, Space, theme } from 'antd';
import { DeleteOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { Channel } from '../../api/channel';
import type { LeadStatus } from '../../api/lead';
import { STATUS_META, flattenChannelOptions, flattenPlatformOptions } from './constants';

interface Props {
  channels: Channel[];
  keyword: string;
  onKeywordChange: (v: string) => void;
  filterChannel: string | undefined;
  onChannelChange: (v: string | undefined) => void;
  filterPlatform: string | undefined;
  onPlatformChange: (v: string | undefined) => void;
  filterStatus: LeadStatus | undefined;
  onStatusChange: (v: LeadStatus | undefined) => void;
  onSearch: () => void;
  onRefresh: () => void;
  isAdmin: boolean;
  selectedCount: number;
  onBatchDelete: () => void;
}

/** 线索列表筛选栏（渠道 / 平台 / 状态 / 关键词 + 批量删除） */
export default function LeadFilterBar({
  channels,
  keyword,
  onKeywordChange,
  filterChannel,
  onChannelChange,
  filterPlatform,
  onPlatformChange,
  filterStatus,
  onStatusChange,
  onSearch,
  onRefresh,
  isAdmin,
  selectedCount,
  onBatchDelete,
}: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const channelOptions = useMemo(() => flattenChannelOptions(channels), [channels]);
  const platformOptions = useMemo(
    () => flattenPlatformOptions(channels, filterChannel),
    [channels, filterChannel],
  );

  return (
    <div
      style={{
        padding: '16px 20px',
        borderBottom: `1px dashed ${token.colorBorderSecondary}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 16,
      }}
    >
      <Space wrap>
        <Select
          style={{ width: 160 }}
          placeholder={t('lead.filterPlatform')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={filterChannel}
          onChange={onChannelChange}
          options={channelOptions}
        />
        <Select
          style={{ width: 180 }}
          placeholder={t('lead.filterShop')}
          allowClear
          showSearch
          optionFilterProp="label"
          value={filterPlatform}
          onChange={onPlatformChange}
          options={platformOptions}
        />
        <Select
          style={{ width: 120 }}
          placeholder={t('lead.filterStatus')}
          allowClear
          value={filterStatus}
          onChange={onStatusChange}
          options={Object.entries(STATUS_META).map(([k, m]) => ({ value: k, label: t(m.label) }))}
        />
        <Input
          style={{ width: 200 }}
          placeholder={t('lead.searchPlaceholder')}
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          onPressEnter={onSearch}
        />
        <Button onClick={onSearch}>{t('common.search')}</Button>
        <Button icon={<ReloadOutlined />} onClick={onRefresh}>
          {t('common.refresh')}
        </Button>
      </Space>
      <Space>
        {isAdmin && selectedCount > 0 && (
          <Popconfirm title={t('lead.batchDeleteConfirm', { n: selectedCount })} onConfirm={onBatchDelete}>
            <Button danger icon={<DeleteOutlined />}>
              {t('common.batchDelete')}
            </Button>
          </Popconfirm>
        )}
      </Space>
    </div>
  );
}
