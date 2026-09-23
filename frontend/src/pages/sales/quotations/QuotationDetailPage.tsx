import { Breadcrumb, Button, Card, Descriptions, Empty, Result, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getQuotation } from '../../../api/quotations';
import { getErrorMessage, getErrorStatus } from '../../../api/request';
import type { QuotationDetail, QuotationItem } from '../../../types/quotation';
import { formatDate, formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import {
  AMOUNT_SOURCE_HINT,
  ITEM_PRODUCT_UNAVAILABLE_LABEL,
  QUOTATION_STATUS_COLOR,
  QUOTATION_STATUS_LABEL,
  STATUS_READONLY_HINT,
} from './constants';
import QuotationFormModal from './QuotationFormModal';

const { Title, Text } = Typography;

/**
 * 报价明细列（字段严格取自 QuotationItem；所有 Decimal 以 string 原样规整展示）
 *
 * 产品不可用（`product === null`：不可见 / 已删除）时：使用**快照** `productName` 作为 fallback 并标注
 * 「历史产品」；快照也被读取侧遮蔽（产品不可见）时显示 '-'。
 */
const itemColumns: ColumnsType<QuotationItem> = [
  {
    title: '产品',
    key: 'product',
    ellipsis: true,
    render: (_: unknown, row) => {
      const name = row.product?.name ?? row.productName;
      if (!name) return '-';
      return (
        <Space size={6}>
          <span>{name}</span>
          {row.product ? null : <Tag color="default">{ITEM_PRODUCT_UNAVAILABLE_LABEL}</Tag>}
        </Space>
      );
    },
  },
  {
    title: 'SKU',
    key: 'sku',
    width: 160,
    render: (_: unknown, row) => textOrDash(row.product?.sku ?? row.productSku),
  },
  { title: '数量', dataIndex: 'quantity', width: 100, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '单位', dataIndex: 'unit', width: 80 },
  { title: '单价', dataIndex: 'unitPrice', width: 120, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '金额', dataIndex: 'amount', width: 130, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '备注', dataIndex: 'remark', width: 160, render: (v: string | null) => textOrDash(v) },
];

/** 同一详情请求的 in-flight 去重（模块级；动机同 F-S2：消除 StrictMode 双请求） */
const detailInFlight = new Map<string, Promise<QuotationDetail>>();

const loadDetail = (id: string, fetcher: () => Promise<QuotationDetail>): Promise<QuotationDetail> => {
  const existing = detailInFlight.get(id);
  if (existing) return existing;
  const task = fetcher().finally(() => detailInFlight.delete(id));
  detailInFlight.set(id, task);
  return task;
};

/**
 * 报价详情页（Round F-S3 · 只读 + 编辑）
 *
 * 数据源：唯一 GET /api/quotations/:id（不新建第二个详情 API）；编辑经 PUT /api/quotations/:id（复用同一弹窗）。
 *
 * 边界：
 *   · 金额全部使用后端返回值（Decimal string，经 formatDecimalString 展示）—— **不做任何前端数值计算**；
 *   · 状态只读展示（后端允许写 status 但无流转规则 ⇒ F-S3 不提供变更入口）；
 *   · 不展示负责人（QUOTATION_INCLUDE 无 owner 投影，且不做前端补查）；
 *   · 不做删除、不做状态流转、不做版本升级、不做报价→订单转换（均属 OUT OF SCOPE）。
 */
export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<QuotationDetail | null>(null);
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
    void loadDetail(id, () => getQuotation(id))
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

  const backToList = useCallback(() => navigate('/sales/quotes'), [navigate]);

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
        title="报价不存在"
        subTitle="该报价不存在，或不在你的数据范围内。"
        extra={
          <Button type="primary" onClick={backToList}>
            返回报价列表
          </Button>
        }
      />
    );
  }

  if (error || !detail) {
    return (
      <Result
        status="error"
        title="加载报价详情失败"
        subTitle={error ?? '未获取到数据'}
        extra={
          <Space>
            <Button type="primary" onClick={() => setReloadToken((token) => token + 1)}>
              重新加载
            </Button>
            <Button onClick={backToList}>返回报价列表</Button>
          </Space>
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Breadcrumb items={[{ title: '报价管理' }, { title: '报价详情' }]} />
        <Space size={12} align="center" style={{ marginTop: 8 }} wrap>
          <Title level={4} style={{ margin: 0 }}>
            {textOrDash(detail.title)}
          </Title>
          <Tag>{textOrDash(detail.quotationNo)}</Tag>
          <Tag>V{detail.version}</Tag>
          <Tag color={QUOTATION_STATUS_COLOR[detail.status] ?? 'default'}>
            {QUOTATION_STATUS_LABEL[detail.status] ?? detail.status}
          </Tag>
          <Button type="primary" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Button onClick={backToList}>返回报价列表</Button>
        </Space>
      </div>

      <Card size="small" title="基础信息">
        <Descriptions
          size="small"
          column={2}
          items={[
            { key: 'quotationNo', label: '报价编号', children: textOrDash(detail.quotationNo) },
            { key: 'title', label: '报价标题', children: textOrDash(detail.title) },
            { key: 'version', label: '版本', children: `V${detail.version}` },
            { key: 'currency', label: '币种', children: textOrDash(detail.currency) },
            {
              key: 'status',
              label: '状态',
              children: (
                <Space size={6}>
                  <Tag color={QUOTATION_STATUS_COLOR[detail.status] ?? 'default'}>
                    {QUOTATION_STATUS_LABEL[detail.status] ?? detail.status}
                  </Tag>
                  <Text type="secondary">{STATUS_READONLY_HINT}</Text>
                </Space>
              ),
            },
            { key: 'validUntil', label: '有效期至', children: formatDate(detail.validUntil) },
            { key: 'createdAt', label: '创建时间', children: formatDateTime(detail.createdAt) },
            { key: 'updatedAt', label: '更新时间', children: formatDateTime(detail.updatedAt) },
            { key: 'tradeTerms', label: '贸易条款', children: textOrDash(detail.tradeTerms) },
            { key: 'paymentTerms', label: '付款条款', children: textOrDash(detail.paymentTerms) },
            {
              key: 'leadTime',
              label: '交期（天）',
              children: detail.leadTime === null ? '-' : String(detail.leadTime),
            },
            { key: 'portOfLoading', label: '装运港', children: textOrDash(detail.portOfLoading) },
            { key: 'notes', label: '备注', children: textOrDash(detail.notes), span: 2 },
          ]}
        />
      </Card>

      <Card size="small" title="关联单据">
        <Descriptions
          size="small"
          column={2}
          items={[
            {
              key: 'opportunity',
              label: '商机',
              children: (
                <Space size={6}>
                  <Link to={`/sales/opportunities/${detail.opportunity.id}`}>
                    {textOrDash(detail.opportunity.title)}
                  </Link>
                  <Text type="secondary">{textOrDash(detail.opportunity.opportunityNo)}</Text>
                </Space>
              ),
            },
            {
              key: 'customer',
              label: '客户',
              children: (
                <Space size={6}>
                  <Link to={`/data/customers/${detail.customer.id}`}>{textOrDash(detail.customer.companyName)}</Link>
                  <Text type="secondary">{textOrDash(detail.customer.customerNo)}</Text>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Card size="small" title={`报价明细（${detail.items.length}）`}>
        {detail.items.length > 0 ? (
          <Table<QuotationItem>
            rowKey="id"
            size="small"
            columns={itemColumns}
            dataSource={detail.items}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无报价明细" />
        )}
      </Card>

      <Card size="small" title="金额合计">
        <Descriptions
          size="small"
          column={2}
          items={[
            {
              key: 'totalAmount',
              label: '报价总额',
              children: `${detail.currency} ${formatDecimalString(detail.totalAmount)}`,
            },
            {
              key: 'totalAmountCny',
              label: '本币折算（CNY）',
              children: detail.totalAmountCny === null ? '-' : formatDecimalString(detail.totalAmountCny),
            },
            {
              key: 'exchangeRate',
              label: '汇率（rateToCny）',
              children: detail.exchangeRate === null ? '-' : formatDecimalString(detail.exchangeRate),
              span: 2,
            },
          ]}
        />
        <Text type="secondary">{AMOUNT_SOURCE_HINT}</Text>
      </Card>

      <QuotationFormModal
        mode="edit"
        open={editOpen}
        quotationId={detail.id}
        onCancel={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          setReloadToken((token) => token + 1);
        }}
      />
    </div>
  );
}
