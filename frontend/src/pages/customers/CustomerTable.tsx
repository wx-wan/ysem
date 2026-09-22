import { Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { CustomerListItem, CustomerPipelineListItem, IntentLevel } from '../../types/customer';
import { formatAmount, formatDate, textOrDash } from '../../utils/format';
import { CUSTOMER_INTENT_LABEL, INTENT_COLOR, INTENT_LABEL, NO_INTENT_LABEL, PIPELINE_AMOUNT_COLUMN_TITLE } from './constants';
import { rememberListSearch } from './returnTo';

const { Text } = Typography;

/**
 * 展示行：由页面把三个列表端点各自的响应映射为统一结构（无类型断言、无 any）。
 * pipelineAmount 仅 /my 与 /all 提供（/public 不存在该字段）。
 */
export interface CustomerDisplayRow {
  key: string;
  customerNo: string;
  companyName: string;
  contactName: string | null;
  country: string | null;
  customerType: string | null;
  ownerName: string | null;
  isKeyAccount: boolean;
  intentLevel: IntentLevel | null;
  lastOrderDate: string | null;
  totalAmount: number | null;
  pipelineAmount?: number;
}

/** CustomerListItem → 展示行（/public：无 pipelineAmount） */
export const toDisplayRow = (item: CustomerListItem, pipelineAmount?: number): CustomerDisplayRow => ({
  key: item.id,
  customerNo: item.customerNo,
  companyName: item.companyName,
  contactName: item.contactName,
  country: item.country,
  customerType: item.customerType,
  ownerName: item.owner?.realName ?? null,
  isKeyAccount: item.isKeyAccount,
  intentLevel: item.intentLevel,
  lastOrderDate: item.lastOrderDate,
  totalAmount: item.totalAmount,
  pipelineAmount,
});

/** /my 与 /all 的列表项（含 pipelineAmount） */
export const toDisplayRowWithPipeline = (item: CustomerPipelineListItem): CustomerDisplayRow =>
  toDisplayRow(item, item.pipelineAmount);

/**
 * 客户列表表格（Round F-6 §18-§21）
 *
 * 列全部来自 CustomerListItem 真实字段；`owner === null` 显示为「公海」（展示语义，非前端过滤）。
 * 金额列只接受 number（后端聚合字段），Null/非法值统一 '-'。
 */
export default function CustomerTable({
  rows,
  loading,
  showPipelineAmount,
  pagination,
}: {
  rows: CustomerDisplayRow[];
  loading: boolean;
  showPipelineAmount: boolean;
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number, pageSize: number) => void;
  };
}) {
  const location = useLocation();
  // 进入详情前记住列表查询串（返回时恢复 view/page/筛选，F-7 §25）
  const remember = useCallback(() => rememberListSearch(location.search), [location.search]);

  const columns: ColumnsType<CustomerDisplayRow> = [
    {
      title: '客户编号',
      dataIndex: 'customerNo',
      width: 150,
      // 仅编号 / 公司名称可点击进入详情（不做整行点击，避免未来操作按钮误触）
      render: (value: string, row) => (
        <Link to={`/data/customers/${row.key}`} onClick={remember}>
          {textOrDash(value)}
        </Link>
      ),
    },
    {
      title: '公司名称',
      dataIndex: 'companyName',
      ellipsis: true,
      render: (value: string, row) => (
        <Link to={`/data/customers/${row.key}`} onClick={remember}>
          <Text strong>{textOrDash(value)}</Text>
        </Link>
      ),
    },
    { title: '联系人', dataIndex: 'contactName', width: 110, render: (v: string | null) => textOrDash(v) },
    { title: '国家', dataIndex: 'country', width: 90, render: (v: string | null) => textOrDash(v) },
    { title: '客户类型', dataIndex: 'customerType', width: 120, render: (v: string | null) => textOrDash(v) },
    {
      title: '负责人',
      dataIndex: 'ownerName',
      width: 110,
      render: (v: string | null) => (v ? v : <Text type="secondary">公海</Text>),
    },
    {
      title: '重点客户',
      dataIndex: 'isKeyAccount',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="blue">是</Tag> : <Text type="secondary">否</Text>),
    },
    {
      // IC-FE-3：此处取 Customer.intentLevel（客户级）；商机意向另属 Opportunity.intentLevel
      title: CUSTOMER_INTENT_LABEL,
      dataIndex: 'intentLevel',
      width: 100,
      render: (v: IntentLevel | null) =>
        v ? (
          <Tag color={INTENT_COLOR[v] ?? 'default'}>{INTENT_LABEL[v] ?? v}</Tag>
        ) : (
          // D-INTENT v2：无商机 / 全部商机无意向 ⇒ 后端返回 null ⇒ 显示「无意向」
          <Text type="secondary">{NO_INTENT_LABEL}</Text>
        ),
    },
    {
      title: '最近下单',
      dataIndex: 'lastOrderDate',
      width: 120,
      render: (v: string | null) => formatDate(v),
    },
    {
      title: '金额',
      dataIndex: 'totalAmount',
      width: 120,
      align: 'right',
      render: (v: number | null) => formatAmount(v),
    },
  ];

  if (showPipelineAmount) {
    columns.push({
      // IC-FE-4：pipelineAmount = 客户**全部商机** estimatedAmount 汇总（含 OPEN/WON/LOST，不过滤 outcome）
      title: PIPELINE_AMOUNT_COLUMN_TITLE,
      dataIndex: 'pipelineAmount',
      width: 190,
      align: 'right',
      render: (v?: number) => formatAmount(v),
    });
  }

  return (
    <Table<CustomerDisplayRow>
      rowKey="key"
      size="middle"
      loading={loading}
      columns={columns}
      dataSource={rows}
      scroll={{ x: 'max-content' }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无客户" /> }}
      pagination={{
        current: pagination.current,
        pageSize: pagination.pageSize,
        total: pagination.total,
        showSizeChanger: true,
        pageSizeOptions: [20, 50, 100],
        showTotal: (total) => `共 ${total} 条`,
        onChange: pagination.onChange,
      }}
    />
  );
}
