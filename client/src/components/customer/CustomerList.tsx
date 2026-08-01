import { useMemo, memo } from 'react';
import { Table, Avatar, Space } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import KeyAccountStar from '../KeyAccountStar';
import FlagIcon from '../FlagIcon';
import type { Customer } from '../../api/customers';
import { getGrade, tagColorToHex } from './utils';
import CustomerTags, { filterCustomTags } from './CustomerTags';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { findCountry } from '../../data/countries';

interface CustomerListProps {
  list: Customer[];
  token: any;
  onOpenDetail: (customer: Customer) => void;
  onListUpdate: (updater: (prev: Customer[]) => Customer[]) => void;
}

const CustomerList = memo(function CustomerList({
  list,
  token,
  onOpenDetail,
  onListUpdate,
}: CustomerListProps) {
  const { format: formatCurrency } = useCurrencyStore();

  const columns = useMemo(() => [
    {
      title: '客户信息',
      dataIndex: 'companyName',
      key: 'companyName',
      width: 280,
      render: (_: string, record: Customer) => {
        const grade = getGrade(record);
        return (
          <Space direction="vertical" size={2}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <KeyAccountStar
                isKeyAccount={record.isKeyAccount || false}
                customerId={record.id}
                color={token.colorWarning}
                mutedColor={token.colorTextQuaternary}
                onToggle={() => {
                  onListUpdate((prev) =>
                    prev.map((c) =>
                      c.id === record.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                    )
                  );
                }}
              />
              <span style={{ fontWeight: 600, color: token.colorTextHeading }}>{record.companyName}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: token.colorTextSecondary }}>
              <Avatar size={20} style={{ backgroundColor: tagColorToHex(grade.tagColor, token), fontSize: 12 }}>{record.contactName?.charAt(0) || '?'}</Avatar>
              <span>{record.contactName || '-'}</span>
              <FlagIcon country={record.country} style={{ borderRadius: 2, width: 18 }} />
              <GlobalOutlined style={{ fontSize: 11 }} />
              <span>{findCountry(record.country)?.zh || (record.country || '-')}</span>
            </div>
          </Space>
        );
      },
    },
    {
      title: '联系方式',
      key: 'contact',
      width: 180,
      render: (_: string, record: Customer) => (
        <div style={{ fontSize: 13 }}>
          <div>{record.email || '-'}</div>
          <div style={{ color: token.colorTextSecondary }}>{record.phone || '-'}</div>
        </div>
      ),
    },
    {
      title: '预计商机金额',
      dataIndex: 'pipelineAmount',
      key: 'pipelineAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: token.colorTextHeading }}>{formatCurrency(v || 0)}</span>
      ),
    },
    {
      title: '成交订单金额',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: 130,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: token.colorTextHeading }}>{formatCurrency(v || 0)}</span>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string) => {
        if (!tags || filterCustomTags(tags).length === 0) return '-';
        return <CustomerTags tags={tags} token={token} />;
      },
    },
  ], [token, onListUpdate, formatCurrency]);

  return (
    <Table
      dataSource={list}
      columns={columns}
      rowKey="id"
      size="middle"
      pagination={false}
      onRow={(record) => ({
        onClick: () => onOpenDetail(record),
        style: { cursor: 'pointer' },
      })}
      style={{ borderRadius: token.borderRadiusLG, overflow: 'hidden' }}
    />
  );
});

export default CustomerList;
