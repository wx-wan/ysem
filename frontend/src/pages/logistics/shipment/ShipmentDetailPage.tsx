import { Breadcrumb, Button, Card, Descriptions, Empty, Result, Space, Spin, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getShipment } from '../../../api/shipments';
import { getErrorMessage, getErrorStatus } from '../../../api/request';
import type { ShipmentDetail, ShipmentItem } from '../../../types/shipment';
import { formatDate, formatDateTime, formatDecimalString, textOrDash } from '../../../utils/format';
import { SHIPMENT_ITEM_LINEAGE_HINT, SHIPMENT_STATUS_COLOR, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_HINT } from './constants';

const { Title, Text } = Typography;

/** 出运明细列（字段严格取自 ShipmentItem；**无产品列** —— 产品经订单行传递） */
const itemColumns: ColumnsType<ShipmentItem> = [
  { title: '订单行', key: 'lineNo', width: 80, render: (_: unknown, row) => row.salesOrderItem?.lineNo ?? '-' },
  {
    title: '产品',
    key: 'product',
    ellipsis: true,
    render: (_: unknown, row) => textOrDash(row.productName || row.salesOrderItem?.productName),
  },
  { title: '规格', dataIndex: 'spec', width: 110, render: (v: string | null) => textOrDash(v) },
  { title: '本次数量', dataIndex: 'quantity', width: 110, align: 'right', render: (v: string) => formatDecimalString(v) },
  { title: '件数', dataIndex: 'packageCount', width: 80, align: 'right', render: (v: number | null) => (v === null ? '-' : v) },
  {
    title: '毛重',
    dataIndex: 'grossWeight',
    width: 100,
    align: 'right',
    render: (v: number | null) => (v === null ? '-' : String(v)),
  },
  { title: '体积', dataIndex: 'volume', width: 100, align: 'right', render: (v: number | null) => (v === null ? '-' : String(v)) },
];

const detailInFlight = new Map<string, Promise<ShipmentDetail>>();

const loadDetail = (id: string, fetcher: () => Promise<ShipmentDetail>): Promise<ShipmentDetail> => {
  const existing = detailInFlight.get(id);
  if (existing) return existing;
  const task = fetcher().finally(() => detailInFlight.delete(id));
  detailInFlight.set(id, task);
  return task;
};

/**
 * 出运单详情页（Round F-S5 · 只读）
 *
 * 边界：状态只读（不提供流转）；不提供编辑/删除（后端 PUT/DELETE 不在本阶段范围）；
 * 不展示不存在的字段；质检仅只读展示（后端 detail include）。
 */
export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);
    void loadDetail(id, () => getShipment(id))
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

  const backToList = useCallback(() => navigate('/logistics/shipment'), [navigate]);

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
        title="出运单不存在"
        subTitle="该出运单不存在，或不在你的数据范围内。"
        extra={
          <Button type="primary" onClick={backToList}>
            返回出运列表
          </Button>
        }
      />
    );
  }

  if (error || !detail) {
    return (
      <Result
        status="error"
        title="加载出运单失败"
        subTitle={error ?? '未获取到数据'}
        extra={
          <Space>
            <Button type="primary" onClick={() => setReloadToken((token) => token + 1)}>
              重新加载
            </Button>
            <Button onClick={backToList}>返回出运列表</Button>
          </Space>
        }
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Breadcrumb items={[{ title: '出运管理' }, { title: '出运详情' }]} />
        <Space size={12} align="center" style={{ marginTop: 8 }} wrap>
          <Title level={4} style={{ margin: 0 }}>
            {textOrDash(detail.shipmentNo)}
          </Title>
          <Tag color={SHIPMENT_STATUS_COLOR[detail.status] ?? 'default'}>
            {SHIPMENT_STATUS_LABEL[detail.status] ?? detail.status}
          </Tag>
          <Button onClick={backToList}>返回出运列表</Button>
        </Space>
      </div>

      <Card size="small" title="出运信息">
        <Descriptions
          size="small"
          column={2}
          items={[
            {
              key: 'salesOrder',
              label: '销售订单',
              children: (
                <Link to={`/sales/orders/${detail.salesOrder.id}`}>{textOrDash(detail.salesOrder.orderNo)}</Link>
              ),
            },
            {
              key: 'customer',
              label: '客户',
              children: (
                <Link to={`/data/customers/${detail.customer.id}`}>{textOrDash(detail.customer.companyName)}</Link>
              ),
            },
            {
              key: 'status',
              label: '状态',
              children: (
                <Space size={6}>
                  <Tag color={SHIPMENT_STATUS_COLOR[detail.status] ?? 'default'}>
                    {SHIPMENT_STATUS_LABEL[detail.status] ?? detail.status}
                  </Tag>
                  <Text type="secondary">{SHIPMENT_STATUS_HINT}</Text>
                </Space>
              ),
            },
            { key: 'shipmentDate', label: '出运日期', children: formatDate(detail.shipmentDate) },
            { key: 'etd', label: 'ETD', children: formatDate(detail.etd) },
            { key: 'eta', label: 'ETA', children: formatDate(detail.eta) },
            { key: 'atd', label: 'ATD', children: formatDate(detail.atd) },
            { key: 'ata', label: 'ATA', children: formatDate(detail.ata) },
            { key: 'carrier', label: '承运人', children: textOrDash(detail.carrier) },
            { key: 'vessel', label: '船名/航班', children: textOrDash(detail.vessel) },
            { key: 'billOfLadingNo', label: '提单号', children: textOrDash(detail.billOfLadingNo) },
            { key: 'trackingNo', label: '跟踪号', children: textOrDash(detail.trackingNo) },
            { key: 'shippingMethod', label: '运输方式', children: textOrDash(detail.shippingMethod) },
            { key: 'incoterm', label: '贸易术语', children: textOrDash(detail.incoterm) },
            { key: 'portOfLoading', label: '装运港', children: textOrDash(detail.portOfLoading) },
            { key: 'portOfDischarge', label: '目的港', children: textOrDash(detail.portOfDischarge) },
            { key: 'packageCount', label: '总件数', children: detail.packageCount === null ? '-' : String(detail.packageCount) },
            {
              key: 'grossWeight',
              label: '总毛重',
              children: detail.grossWeight === null ? '-' : String(detail.grossWeight),
            },
            { key: 'netWeight', label: '净重', children: detail.netWeight === null ? '-' : String(detail.netWeight) },
            { key: 'volume', label: '体积', children: detail.volume === null ? '-' : String(detail.volume) },
            {
              key: 'freightAmount',
              label: '运费',
              children:
                detail.freightAmount === null
                  ? '-'
                  : `${detail.freightCurrency ?? ''} ${formatDecimalString(detail.freightAmount)}`.trim(),
            },
            {
              key: 'freightAmountCny',
              label: '运费（CNY）',
              children: detail.freightAmountCny === null ? '-' : formatDecimalString(detail.freightAmountCny),
            },
            { key: 'customsDeclarationNo', label: '报关单号', children: textOrDash(detail.customsDeclarationNo) },
            { key: 'createdAt', label: '创建时间', children: formatDateTime(detail.createdAt) },
            { key: 'updatedAt', label: '更新时间', children: formatDateTime(detail.updatedAt) },
            { key: 'notes', label: '备注', children: textOrDash(detail.notes), span: 2 },
          ]}
        />
      </Card>

      <Card size="small" title={`出运明细（${detail.items.length}）`}>
        {detail.items.length > 0 ? (
          <>
            <Table<ShipmentItem>
              rowKey="id"
              size="small"
              columns={itemColumns}
              dataSource={detail.items}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
            <Text type="secondary">{SHIPMENT_ITEM_LINEAGE_HINT}</Text>
          </>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无出运明细" />
        )}
      </Card>

      <Card size="small" title={`质检记录（${detail.inspections.length}）`}>
        {detail.inspections.length > 0 ? (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={detail.inspections}
            columns={[
              { title: '质检单号', dataIndex: 'inspectionNo', width: 170 },
              { title: '类型', dataIndex: 'type', width: 140 },
              { title: '结果', dataIndex: 'result', render: (v: string | null) => textOrDash(v) },
            ]}
          />
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无质检记录" />
        )}
      </Card>
    </div>
  );
}
