import { Breadcrumb, Button, Card, Descriptions, Empty, Result, Space, Spin, Table, Tag, Timeline, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getOpportunity } from '../../../api/sales';
import { getErrorMessage, getErrorStatus } from '../../../api/request';
import type { OpportunityDetail, OpportunityItem } from '../../../types/sales';
import { formatDate, formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import {
  ACTIVITY_TAKE_LIMIT,
  INTENT_LEVEL_COLOR,
  INTENT_LEVEL_LABEL,
  OPPORTUNITY_ACTIVITY_LABEL,
  OPPORTUNITY_INTENT_LABEL,
  OPPORTUNITY_OUTCOME_COLOR,
  OPPORTUNITY_OUTCOME_LABEL,
  STAGE_COLOR,
  STAGE_DERIVED_HINT,
  STAGE_LABEL,
} from './constants';
import OpportunityFormModal from './OpportunityFormModal';

const { Title, Text } = Typography;

/** 产品明细列（字段严格取自 OpportunityItem；Decimal 以 string 原样规整展示） */
const itemColumns: ColumnsType<OpportunityItem> = [
  {
    title: '产品',
    key: 'product',
    ellipsis: true,
    render: (_: unknown, row) => textOrDash(row.product?.name ?? row.productName),
  },
  { title: 'SKU', key: 'sku', width: 150, render: (_: unknown, row) => textOrDash(row.product?.sku) },
  { title: '规格', dataIndex: 'spec', width: 120, render: (value: string | null) => textOrDash(value) },
  { title: '数量', dataIndex: 'quantity', width: 90, align: 'right' },
  {
    title: '目标单价',
    dataIndex: 'targetPrice',
    width: 120,
    align: 'right',
    render: (value: string | null) => formatDecimalString(value),
  },
  { title: '币种', dataIndex: 'currency', width: 80 },
  { title: '备注', dataIndex: 'remark', width: 160, render: (value: string | null) => textOrDash(value) },
];

/** 同一详情请求的 in-flight 去重（模块级；动机同 CustomerDetailPage：消除 StrictMode 双请求） */
const detailInFlight = new Map<string, Promise<OpportunityDetail>>();

const loadDetail = (id: string, fetcher: () => Promise<OpportunityDetail>): Promise<OpportunityDetail> => {
  const existing = detailInFlight.get(id);
  if (existing) return existing;
  const task = fetcher().finally(() => detailInFlight.delete(id));
  detailInFlight.set(id, task);
  return task;
};

/**
 * 商机详情页（Round F-S2 · **只读 + 编辑**）
 *
 * 数据源：唯一 GET /api/sales/:id（不新建第二个详情 API）；编辑经 PUT /api/sales/:id（复用同一表单弹窗）。
 *
 * 边界：
 *   · 只展示后端真实存在的字段（无「商机金额」「状态机」等合成概念）；
 *   · 阶段 stage 为**派生值**（后端按关联单据推导）—— 不提供人工切换入口；
 *   · 结论 outcome 后端无流转规则 ⇒ 本阶段仅展示（不提供变更按钮）；
 *   · 不做删除、不做报价/订单/出运/收款（均属 OUT OF SCOPE）。
 */
export default function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    void loadDetail(id, () => getOpportunity(id))
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (getErrorStatus(err) === 404) setNotFound(true);
        else setError(getErrorMessage(err));
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadToken]);

  const backToList = useCallback(() => navigate('/sales/opportunities'), [navigate]);

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
        title="商机不存在"
        subTitle="该商机不存在，或不在你的数据范围内。"
        extra={
          <Button type="primary" onClick={backToList}>
            返回商机列表
          </Button>
        }
      />
    );
  }

  if (error || !detail) {
    return (
      <Result
        status="error"
        title="加载商机详情失败"
        subTitle={error ?? '未获取到数据'}
        extra={
          <Space>
            <Button type="primary" onClick={() => setReloadToken((token) => token + 1)}>
              重新加载
            </Button>
            <Button onClick={backToList}>返回商机列表</Button>
          </Space>
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Breadcrumb items={[{ title: '商机管理' }, { title: '商机详情' }]} />
        <Space size={12} align="center" style={{ marginTop: 8 }} wrap>
          <Title level={4} style={{ margin: 0 }}>
            {textOrDash(detail.title)}
          </Title>
          <Tag>{textOrDash(detail.opportunityNo)}</Tag>
          <Tag color={STAGE_COLOR[detail.stage] ?? 'default'}>{STAGE_LABEL[detail.stage] ?? detail.stage}</Tag>
          <Button type="primary" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Button onClick={backToList}>返回商机列表</Button>
        </Space>
      </div>

      <Card size="small" title="商机概览">
        <Descriptions
          size="small"
          column={2}
          items={[
            {
              key: 'customer',
              label: '客户',
              children: <Link to={`/data/customers/${detail.customer.id}`}>{textOrDash(detail.customer.companyName)}</Link>,
            },
            {
              key: 'owner',
              label: '负责人',
              children: detail.owner?.realName ? detail.owner.realName : <Text type="secondary">未分配</Text>,
            },
            {
              key: 'stage',
              label: '阶段',
              children: (
                <Space size={6}>
                  <Tag color={STAGE_COLOR[detail.stage] ?? 'default'}>{STAGE_LABEL[detail.stage] ?? detail.stage}</Tag>
                  <Text type="secondary">{STAGE_DERIVED_HINT}</Text>
                </Space>
              ),
            },
            {
              key: 'outcome',
              label: '结论',
              children: (
                <Tag color={OPPORTUNITY_OUTCOME_COLOR[detail.outcome] ?? 'default'}>
                  {OPPORTUNITY_OUTCOME_LABEL[detail.outcome] ?? detail.outcome}
                </Tag>
              ),
            },
            {
              key: 'intentLevel',
              label: OPPORTUNITY_INTENT_LABEL,
              children: detail.intentLevel ? (
                <Tag color={INTENT_LEVEL_COLOR[detail.intentLevel] ?? 'default'}>
                  {INTENT_LEVEL_LABEL[detail.intentLevel] ?? detail.intentLevel}
                </Tag>
              ) : (
                '-'
              ),
            },
            {
              key: 'estimatedAmount',
              label: '预计金额',
              children:
                detail.estimatedAmount === null
                  ? '-'
                  : `${detail.currency} ${formatDecimalString(detail.estimatedAmount)}`,
            },
            {
              key: 'probability',
              label: '成交概率',
              children: detail.probability === null ? '-' : `${formatDecimalString(detail.probability)}%`,
            },
            {
              key: 'estimatedCloseDate',
              label: '预计成交日期',
              children: formatDate(detail.estimatedCloseDate),
            },
            { key: 'createdAt', label: '创建时间', children: formatDateTime(detail.createdAt) },
            { key: 'updatedAt', label: '更新时间', children: formatDateTime(detail.updatedAt) },
            {
              key: 'lead',
              label: '来源线索',
              children: detail.lead ? textOrDash(detail.lead.leadName) : '-',
            },
            { key: 'notes', label: '备注', children: textOrDash(detail.notes), span: 2 },
          ]}
        />
      </Card>

      <Card size="small" title={`产品明细（${detail.items.length}）`}>
        {detail.items.length > 0 ? (
          <Table<OpportunityItem>
            rowKey="id"
            size="small"
            columns={itemColumns}
            dataSource={detail.items}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无产品明细" />
        )}
      </Card>

      <Card size="small" title={`跟进记录（最近 ${ACTIVITY_TAKE_LIMIT} 条）`}>
        {detail.activities.length > 0 ? (
          <Timeline
            items={detail.activities.map((activity) => ({
              key: activity.id,
              children: (
                <div>
                  <Space size={8}>
                    <Text strong>{OPPORTUNITY_ACTIVITY_LABEL[activity.action] ?? activity.action}</Text>
                    <Text type="secondary">{formatDateTime(activity.createdAt)}</Text>
                  </Space>
                  {activity.comment ? <div>{activity.comment}</div> : null}
                  {activity.fromStage || activity.toStage ? (
                    <Text type="secondary">
                      {textOrDash(activity.fromStage)} → {textOrDash(activity.toStage)}
                    </Text>
                  ) : null}
                </div>
              ),
            }))}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无跟进记录" />
        )}
      </Card>

      <OpportunityFormModal
        mode="edit"
        open={editOpen}
        opportunityId={detail.id}
        onCancel={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          setReloadToken((token) => token + 1);
        }}
      />
    </div>
  );
}
