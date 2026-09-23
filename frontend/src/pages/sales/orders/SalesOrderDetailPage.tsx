import { Breadcrumb, Button, Card, Descriptions, Empty, Result, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getSalesOrder } from '../../../api/salesOrders';
import { getErrorMessage, getErrorStatus } from '../../../api/request';
import type { SalesOrderDetail, SalesOrderItem } from '../../../types/salesOrder';
import { formatDate, formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import {
  ITEM_PRODUCT_UNAVAILABLE_LABEL,
  ORDER_STATUS_COLOR,
  ORDER_STATUS_LABEL,
  SNAPSHOT_OMIT_NOTE,
  STATUS_READONLY_HINT,
} from './constants';
import SalesOrderFormModal from './SalesOrderFormModal';

const { Title, Text } = Typography;

/** 明细列（字段严格取自 SalesOrderItem；Decimal 以 string 原样规整展示） */
const itemColumns: ColumnsType<SalesOrderItem> = [
  { title: '行号', dataIndex: 'lineNo', width: 60 },
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
    width: 150,
    render: (_: unknown, row) => textOrDash(row.product?.sku ?? row.productSku),
  },
  { title: '规格', dataIndex: 'spec', width: 110, render: (v: string | null) => textOrDash(v) },
  { title: '数量', dataIndex: 'quantity', width: 100, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '单位', dataIndex: 'unit', width: 70 },
  { title: '单价', dataIndex: 'unitPrice', width: 110, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '金额', dataIndex: 'amount', width: 120, align: 'right', render: (v: string) => formatDecimalString(v) },
  {
    title: '已出运',
    dataIndex: 'shippedQty',
    width: 100,
    align: 'right',
    render: (v: string) => formatDecimalString(v),
  },
  { title: '行备注', dataIndex: 'remark', width: 160, render: (v: string | null) => textOrDash(v) },
];

/** 详情请求 in-flight 去重（模块级；与 F-S2/F-S3 同型） */
const detailInFlight = new Map<string, Promise<SalesOrderDetail>>();

const loadDetail = (id: string, fetcher: () => Promise<SalesOrderDetail>): Promise<SalesOrderDetail> => {
  const existing = detailInFlight.get(id);
  if (existing) return existing;
  const task = fetcher().finally(() => detailInFlight.delete(id));
  detailInFlight.set(id, task);
  return task;
};

/**
 * 销售订单详情页（Round F-S4 · 只读 + 编辑）
 *
 * 数据源：唯一 GET /api/sales-orders/:id；编辑经 PUT /api/sales-orders/:id（复用同一弹窗）。
 * 边界（D-FS4-018/019/023/025/026/028）：
 *   · 不展示负责人（后端无 owner 投影）；不展示 customerSnapshot / termsSnapshot（后端 Deferred）；
 *   · 状态只读；无删除；无「完成」按钮（COMPLETED 属 F-S6）；不实现出运/收款/生产业务。
 */
export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<SalesOrderDetail | null>(null);
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
    void loadDetail(id, () => getSalesOrder(id))
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

  const backToList = useCallback(() => navigate('/sales/orders'), [navigate]);

  /**
   * F-S5：创建出运单入口（唯一入口；不改变订单业务规则）
   * 跳转 /logistics/shipment?salesOrderId=<当前订单 id> ⇒ 出运列表页自动打开创建弹窗并带入订单明细；
   * 出运数量由后端校验上限并重算 shippedQty（前端不计算、不回写）。
   */
  const createShipment = useCallback(() => {
    if (!detail?.id) return;
    navigate(`/logistics/shipment?salesOrderId=${encodeURIComponent(detail.id)}`);
  }, [navigate, detail?.id]);

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
        title="销售订单不存在"
        subTitle="该订单不存在，或不在你的数据范围内。"
        extra={
          <Button type="primary" onClick={backToList}>
            返回订单列表
          </Button>
        }
      />
    );
  }

  if (error || !detail) {
    return (
      <Result
        status="error"
        title="加载销售订单失败"
        subTitle={error ?? '未获取到数据'}
        extra={
          <Space>
            <Button type="primary" onClick={() => setReloadToken((token) => token + 1)}>
              重新加载
            </Button>
            <Button onClick={backToList}>返回订单列表</Button>
          </Space>
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Breadcrumb items={[{ title: '销售订单' }, { title: '订单详情' }]} />
        <Space size={12} align="center" style={{ marginTop: 8 }} wrap>
          <Title level={4} style={{ margin: 0 }}>
            {textOrDash(detail.orderNo)}
          </Title>
          <Tag color={ORDER_STATUS_COLOR[detail.status] ?? 'default'}>
            {ORDER_STATUS_LABEL[detail.status] ?? detail.status}
          </Tag>
          <Button type="primary" onClick={() => setEditOpen(true)}>
            编辑
          </Button>
          <Button onClick={createShipment}>创建出运单</Button>
          <Button onClick={backToList}>返回订单列表</Button>
        </Space>
      </div>

      <Card size="small" title="订单信息">
        <Descriptions
          size="small"
          column={2}
          items={[
            { key: 'orderNo', label: '订单号', children: textOrDash(detail.orderNo) },
            {
              key: 'status',
              label: '状态',
              children: (
                <Space size={6}>
                  <Tag color={ORDER_STATUS_COLOR[detail.status] ?? 'default'}>
                    {ORDER_STATUS_LABEL[detail.status] ?? detail.status}
                  </Tag>
                  <Text type="secondary">{STATUS_READONLY_HINT}</Text>
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
            {
              key: 'opportunity',
              label: '商机',
              children: (
                <Link to={`/sales/opportunities/${detail.opportunity.id}`}>{textOrDash(detail.opportunity.title)}</Link>
              ),
            },
            {
              key: 'quotation',
              label: '来源报价',
              children: detail.quotation ? (
                <Space size={6}>
                  <Link to={`/sales/quotes/${detail.quotation.id}`}>{textOrDash(detail.quotation.title)}</Link>
                  <Text type="secondary">{textOrDash(detail.quotation.quotationNo)}</Text>
                </Space>
              ) : (
                '-'
              ),
            },
            { key: 'currency', label: '币种', children: textOrDash(detail.currency) },
            { key: 'orderDate', label: '订单日期', children: formatDate(detail.orderDate) },
            { key: 'deliveryDate', label: '交付日期', children: formatDate(detail.deliveryDate) },
            { key: 'actualDeliveryDate', label: '实际交付日期', children: formatDate(detail.actualDeliveryDate) },
            { key: 'createdAt', label: '创建时间', children: formatDateTime(detail.createdAt) },
            { key: 'updatedAt', label: '更新时间', children: formatDateTime(detail.updatedAt) },
            { key: 'tradeTerms', label: '贸易条款', children: textOrDash(detail.tradeTerms) },
            { key: 'paymentTerms', label: '付款条款', children: textOrDash(detail.paymentTerms) },
            { key: 'portOfLoading', label: '装运港', children: textOrDash(detail.portOfLoading) },
            { key: 'portOfDischarge', label: '目的港', children: textOrDash(detail.portOfDischarge) },
            { key: 'cancelReason', label: '取消原因', children: textOrDash(detail.cancelReason) },
            { key: 'remark', label: '备注', children: textOrDash(detail.remark), span: 2 },
          ]}
        />
        <Text type="secondary">{SNAPSHOT_OMIT_NOTE}</Text>
      </Card>

      <Card size="small" title={`订单明细（${detail.items.length}）`}>
        {detail.items.length > 0 ? (
          <Table<SalesOrderItem>
            rowKey="id"
            size="small"
            columns={itemColumns}
            dataSource={detail.items}
            pagination={false}
            scroll={{ x: 'max-content' }}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无订单明细" />
        )}
      </Card>

      <Card size="small" title="金额">
        <Descriptions
          size="small"
          column={3}
          items={[
            {
              key: 'totalAmount',
              label: '订单金额',
              children: `${detail.currency} ${formatDecimalString(detail.totalAmount)}`,
            },
            {
              key: 'totalAmountCny',
              label: '本币金额（CNY）',
              children: detail.totalAmountCny === null ? '-' : formatDecimalString(detail.totalAmountCny),
            },
            {
              key: 'paidAmountCny',
              label: '已收（CNY）',
              children: formatDecimalString(detail.paidAmountCny),
            },
            {
              key: 'depositRatio',
              label: '定金比例',
              children: detail.depositRatio === null ? '-' : `${formatDecimalString(detail.depositRatio)}%`,
            },
            {
              key: 'depositAmount',
              label: '定金金额',
              children: detail.depositAmount === null ? '-' : formatDecimalString(detail.depositAmount),
            },
            {
              key: 'balanceAmount',
              label: '尾款金额',
              children: detail.balanceAmount === null ? '-' : formatDecimalString(detail.balanceAmount),
            },
          ]}
        />
      </Card>

      <SalesOrderFormModal
        mode="edit"
        open={editOpen}
        salesOrderId={detail.id}
        onCancel={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          setReloadToken((token) => token + 1);
        }}
      />
    </div>
  );
}
