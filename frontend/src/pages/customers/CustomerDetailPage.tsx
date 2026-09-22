import { Alert, Breadcrumb, Button, Card, Descriptions, Empty, Image, Result, Space, Spin, Table, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getErrorMessage, getErrorStatus } from '../../api/request';
import { useCustomers } from '../../hooks/useCustomers';
import type { CustomerActivity, CustomerDetail, CustomerOpportunity, CustomerSalesOrder, CustomerSalesOrderItem } from '../../types/customer';
import { formatDate, formatDateTime, formatDecimalString, textOrDash } from '../../utils/format';
import {
  ACTIVITY_ACTION_LABEL,
  ACTIVITY_TAKE_LIMIT,
  CUSTOMER_INTENT_LABEL,
  CUSTOMER_LEVEL_LABEL,
  INTENT_COLOR,
  INTENT_LABEL,
  LEAD_SOURCE_LABEL,
  NO_INTENT_LABEL,
  OPPORTUNITY_INTENT_LABEL,
  OPPORTUNITY_OUTCOME_COLOR,
  OPPORTUNITY_OUTCOME_LABEL,
  SALES_ORDER_STATUS_COLOR,
  SALES_ORDER_STATUS_LABEL,
  STATUS_NO_WORKFLOW_NOTE,
} from './constants';
import CustomerFormModal from './CustomerFormModal';
import { getListReturnPath } from './returnTo';

const { Title, Text } = Typography;

const CUSTOMER_STATUS_LABEL: Record<string, string> = { ACTIVE: '启用', INACTIVE: '停用' };

/**
 * 同一客户详情的 in-flight 去重（模块级）。
 * 动机同 F-6 D-1：React StrictMode 在开发环境双执行 effect，若不共享 in-flight promise，
 * 同一 id 会发出两次请求。请求 settle 后立即移除 —— 不是缓存（重新加载/刷新仍会真实请求）。
 */
const detailInFlight = new Map<string, Promise<CustomerDetail>>();

const loadDetail = (id: string, fetcher: () => Promise<CustomerDetail>): Promise<CustomerDetail> => {
  const existing = detailInFlight.get(id);
  if (existing) return existing;
  const task = fetcher().finally(() => detailInFlight.delete(id));
  detailInFlight.set(id, task);
  return task;
};

/** 商机表列（字段严格取自 CustomerOpportunity；Decimal 以 string 原样规整展示） */
const opportunityColumns: ColumnsType<CustomerOpportunity> = [
  { title: '商机编号', dataIndex: 'opportunityNo', width: 150 },
  { title: '商机名称', dataIndex: 'title', ellipsis: true },
  {
    title: '负责人',
    dataIndex: 'owner',
    width: 110,
    render: (_: unknown, row) => (row.owner?.realName ? row.owner.realName : <Text type="secondary">未分配</Text>),
  },
  {
    title: '状态',
    dataIndex: 'outcome',
    width: 90,
    render: (value: string) => <Tag color={OPPORTUNITY_OUTCOME_COLOR[value] ?? 'default'}>{OPPORTUNITY_OUTCOME_LABEL[value] ?? value}</Tag>,
  },
  {
    // IC-FE-3：此处为 **商机** 的 intentLevel（Opportunity），与 Customer.intentLevel 是两个实体
    title: OPPORTUNITY_INTENT_LABEL,
    dataIndex: 'intentLevel',
    width: 100,
    render: (value: string | null) => (value ? <Tag color={INTENT_COLOR[value] ?? 'default'}>{INTENT_LABEL[value] ?? value}</Tag> : '-'),
  },
  {
    title: '预计金额',
    dataIndex: 'estimatedAmount',
    width: 140,
    align: 'right',
    render: (_: unknown, row) => `${row.currency} ${formatDecimalString(row.estimatedAmount)}`,
  },
  {
    title: '概率',
    dataIndex: 'probability',
    width: 80,
    align: 'right',
    render: (value: string | null) => (value === null ? '-' : `${formatDecimalString(value)}%`),
  },
  { title: '预计成交', dataIndex: 'estimatedCloseDate', width: 120, render: (value: string | null) => formatDate(value) },
  { title: '创建时间', dataIndex: 'createdAt', width: 150, render: (value: string) => formatDateTime(value) },
];

/** 销售订单明细列（CustomerSalesOrderItem 投影） */
const orderItemColumns: ColumnsType<CustomerSalesOrderItem> = [
  { title: '行号', dataIndex: 'lineNo', width: 60 },
  { title: '产品', dataIndex: 'productName', ellipsis: true },
  { title: '规格', dataIndex: 'spec', width: 120, render: (value: string | null) => textOrDash(value) },
  { title: '数量', dataIndex: 'quantity', width: 100, align: 'right', render: (value: string) => `${formatDecimalString(value)} ${''}`.trim() },
  { title: '单位', dataIndex: 'unit', width: 70 },
  { title: '单价', dataIndex: 'unitPrice', width: 110, align: 'right', render: (value: string) => formatDecimalString(value) },
  { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (value: string) => formatDecimalString(value) },
];

/** 销售订单列（CustomerSalesOrder 投影） */
const salesOrderColumns: ColumnsType<CustomerSalesOrder> = [
  { title: '销售订单号', dataIndex: 'orderNo', width: 160 },
  {
    title: '状态',
    dataIndex: 'status',
    width: 100,
    render: (value: string) => <Tag color={SALES_ORDER_STATUS_COLOR[value] ?? 'default'}>{SALES_ORDER_STATUS_LABEL[value] ?? value}</Tag>,
  },
  { title: '币种', dataIndex: 'currency', width: 80 },
  { title: '订单金额', dataIndex: 'totalAmount', width: 120, align: 'right', render: (value: string) => formatDecimalString(value) },
  { title: '本币金额', dataIndex: 'totalAmountCny', width: 120, align: 'right', render: (value: string | null) => formatDecimalString(value) },
  { title: '已收款', dataIndex: 'paidAmountCny', width: 120, align: 'right', render: (value: string) => formatDecimalString(value) },
  { title: '订单日期', dataIndex: 'orderDate', width: 120, render: (value: string | null) => formatDate(value) },
  { title: '交付日期', dataIndex: 'deliveryDate', width: 120, render: (value: string | null) => formatDate(value) },
];

/**
 * 客户详情页（Round F-7 · **只读**）
 *
 * 数据源：唯一 GET /api/customers/:id（F-5 `getCustomer`，不新建第二个详情 API）。
 * 契约：CustomerDetail = 29 个标量 + owner + salesOrders(.items) + opportunities(.owner) + activities(≤50, asc)。
 *
 * 边界：
 *   · **只读**：无 create/update/delete/claim/release/transfer/tags/import、无 owner selector、无写请求；
 *   · owner 仅展示（owner=null → 公海），不调用任何选人接口（F-01 仍 BLOCKED）；
 *   · 不 dump 整个响应对象：逐字段显式选择，token/password/refreshTokens 等永不进入 DOM；
 *   · 不依赖列表页 state —— 直接访问 / 刷新 / 新标签页都会重新请求。
 */
export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getCustomer } = useCustomers();

  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setNotFound(false);
      try {
        const data = await loadDetail(id, () => getCustomer(id));
        if (!cancelled) setDetail(data);
      } catch (err) {
        if (cancelled) return;
        setDetail(null);
        // 仅 404（不存在或不可见）走 Result；其余失败走 Alert（不把任意错误当 404）
        if (getErrorStatus(err) === 404) setNotFound(true);
        else setError(getErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, getCustomer, reloadToken]);

  const backToList = useCallback(() => navigate(getListReturnPath()), [navigate]);

  const header = (
    <div>
      <Breadcrumb items={[{ title: '客户管理' }, { title: '客户详情' }]} />
      <Space size={12} align="center" style={{ marginTop: 8 }}>
        <Title level={4} style={{ margin: 0 }}>
          {detail ? textOrDash(detail.companyName) : '客户详情'}
        </Title>
        {detail ? <Tag>{textOrDash(detail.customerNo)}</Tag> : null}
        {detail ? (
          <Button type="primary" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
        ) : null}
        <Button onClick={backToList}>返回客户列表</Button>
      </Space>
    </div>
  );

  if (loading && !detail) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 80 }}>
        <Spin />
        <Text type="secondary">加载中…</Text>
      </div>
    );
  }

  if (notFound) {
    return (
      <Result
        status="404"
        title="客户不存在"
        subTitle="该客户不存在，或你无权查看。"
        extra={<Button type="primary" onClick={backToList}>返回客户列表</Button>}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {header}

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载客户详情失败"
          description={error}
          action={
            <Button size="small" onClick={() => setReloadToken((t) => t + 1)}>
              重新加载
            </Button>
          }
        />
      ) : null}

      {detail ? (
        <>
          <Card size="small" title="客户概览">
            <Descriptions
              size="small"
              column={3}
              items={[
                { key: 'customerNo', label: '客户编号', children: textOrDash(detail.customerNo) },
                { key: 'companyName', label: '公司名称', children: textOrDash(detail.companyName) },
                { key: 'englishName', label: '英文名称', children: textOrDash(detail.englishName) },
                { key: 'contactName', label: '联系人', children: textOrDash(detail.contactName) },
                { key: 'position', label: '职位', children: textOrDash(detail.position) },
                { key: 'email', label: '邮箱', children: textOrDash(detail.email) },
                { key: 'phone', label: '电话', children: textOrDash(detail.phone) },
                { key: 'wechat', label: '微信', children: textOrDash(detail.wechat) },
                { key: 'country', label: '国家', children: textOrDash(detail.country) },
                { key: 'customerType', label: '客户类型', children: textOrDash(detail.customerType) },
                {
                  key: 'owner',
                  label: '负责人',
                  children: detail.owner?.realName ? detail.owner.realName : <Text type="secondary">公海</Text>,
                },
                {
                  key: 'tags',
                  label: '标签',
                  children:
                    detail.tags.length > 0 ? (
                      <Space size={4} wrap>
                        {detail.tags.map((tag) => (
                          <Tag key={tag}>{tag}</Tag>
                        ))}
                      </Space>
                    ) : (
                      <Text type="secondary">暂无标签</Text>
                    ),
                },
                {
                  // D-FE-CARD-6：客户名片（后端字段仍为 coverImage，业务名统一「客户名片」）
                  key: 'coverImage',
                  label: '客户名片',
                  children: detail.coverImage ? (
                    <Image src={detail.coverImage} width={120} alt="客户名片" />
                  ) : (
                    <Text type="secondary">无客户名片</Text>
                  ),
                },
              ]}
            />
          </Card>

          <Card size="small" title="业务信息">
            <Descriptions
              size="small"
              column={3}
              items={[
                { key: 'customerLevel', label: '客户等级', children: CUSTOMER_LEVEL_LABEL[detail.customerLevel] ?? detail.customerLevel },
                { key: 'source', label: '客户来源', children: detail.source ? (LEAD_SOURCE_LABEL[detail.source] ?? detail.source) : '-' },
                {
                  key: 'intentLevel',
                  // IC-FE-3：客户级意向（Customer.intentLevel），与商机意向区分
                  // D-INTENT v2：该值为后端只读派生（= 关联商机最高意向），无商机 ⇒ null ⇒「无意向」
                  label: CUSTOMER_INTENT_LABEL,
                  children: (
                    <Space size={6}>
                      {detail.intentLevel ? (
                        <Tag color={INTENT_COLOR[detail.intentLevel] ?? 'default'}>{INTENT_LABEL[detail.intentLevel] ?? detail.intentLevel}</Tag>
                      ) : (
                        <Text type="secondary">{NO_INTENT_LABEL}</Text>
                      )}
                      <Text type="secondary">由关联商机意向自动派生</Text>
                    </Space>
                  ),
                },
                { key: 'isKeyAccount', label: '重点客户', children: detail.isKeyAccount ? <Tag color="blue">是</Tag> : '否' },
                {
                  key: 'status',
                  // IC-FE-2：该字段当前无流转规则（后端无写入方/无过滤）⇒ 文案不得暗示状态机
                  label: '记录状态',
                  children: (
                    <Space size={4}>
                      <span>{CUSTOMER_STATUS_LABEL[detail.status] ?? detail.status}</span>
                      <Text type="secondary">{STATUS_NO_WORKFLOW_NOTE}</Text>
                    </Space>
                  ),
                },
                { key: 'region', label: '地区', children: textOrDash(detail.region) },
                { key: 'firstOrderAt', label: '首次下单', children: formatDate(detail.firstOrderAt) },
                // IC-FE-1：已移除 lastOrderAt / totalOrderAmountCny（后端死列，禁止消费 —— D-DEAD-FIELDS）。
                { key: 'createdAt', label: '创建时间', children: formatDateTime(detail.createdAt) },
                { key: 'updatedAt', label: '更新时间', children: formatDateTime(detail.updatedAt) },
                { key: 'notes', label: '备注', children: textOrDash(detail.notes) },
              ]}
            />
          </Card>

          <Card size="small" title={`商机（${detail.opportunities.length}）`}>
            {detail.opportunities.length > 0 ? (
              <Table<CustomerOpportunity>
                rowKey="id"
                size="small"
                columns={opportunityColumns}
                dataSource={detail.opportunities}
                pagination={false}
                scroll={{ x: 'max-content' }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无商机" />
            )}
          </Card>

          <Card size="small" title={`销售订单（${detail.salesOrders.length}）`}>
            {detail.salesOrders.length > 0 ? (
              <Table<CustomerSalesOrder>
                rowKey="id"
                size="small"
                columns={salesOrderColumns}
                dataSource={detail.salesOrders}
                pagination={false}
                scroll={{ x: 'max-content' }}
                expandable={{
                  expandedRowRender: (row) =>
                    row.items.length > 0 ? (
                      <Table<CustomerSalesOrderItem>
                        rowKey="id"
                        size="small"
                        columns={orderItemColumns}
                        dataSource={row.items}
                        pagination={false}
                      />
                    ) : (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无明细" />
                    ),
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无销售订单" />
            )}
          </Card>

          <Card size="small" title={`活动记录（${detail.activities.length}${detail.activities.length >= ACTIVITY_TAKE_LIMIT ? `，最多显示 ${ACTIVITY_TAKE_LIMIT} 条` : ''}）`}>
            {detail.activities.length > 0 ? (
              <Timeline
                items={detail.activities.map((activity: CustomerActivity) => ({
                  key: activity.id,
                  // antd 6：items.label/children 已弃用，改用 title/content
                  title: formatDateTime(activity.createdAt),
                  content: (
                    <Space size={8} wrap>
                      <Tag>{ACTIVITY_ACTION_LABEL[activity.action] ?? activity.action}</Tag>
                      <Text>{textOrDash(activity.realName)}</Text>
                      <Text type="secondary">{textOrDash(activity.summary ?? activity.detail)}</Text>
                      {/* diff 为字符串（F-0）：本轮只标识「有变更」，不做 JSON.parse 二次解析 */}
                      {activity.diff ? <Tag color="gold">有变更</Tag> : null}
                    </Space>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无活动记录" />
            )}
          </Card>
          </>
          ) : null}

          {/* F-8：编辑客户（Edit contract；ownerId 仅「保持 / 公海」，无其他用户选择） */}
          <CustomerFormModal
          mode="edit"
          open={editOpen}
          initial={detail}
          onCancel={() => setEditOpen(false)}
          onSaved={() => {
          setEditOpen(false);
          setReloadToken((t) => t + 1);
          }}
          />
          </div>
          );
          }
