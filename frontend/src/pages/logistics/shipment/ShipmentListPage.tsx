import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getShipments } from '../../../api/shipments';
import { getErrorMessage } from '../../../api/request';
import type { PageResult } from '../../../types/masterData';
import type { ShipmentListItem, ShipmentStatus } from '../../../types/shipment';
import { DEFAULT_PAGE_SIZE, SHIPMENT_STATUS_FILTER_OPTIONS, SHIPMENT_STATUS_HINT } from './constants';
import ShipmentFormModal from './ShipmentFormModal';
import ShipmentTable from './ShipmentTable';

const { Title, Text } = Typography;

/**
 * 出运单列表页（Round F-S5）
 *
 * 路由：/logistics/shipment（与菜单权限码 `shipment` 的 path 同源）
 * 入口协议：订单详情「创建出运单」→ `/logistics/shipment?salesOrderId=<id>` ⇒ 自动打开创建弹窗（一次）
 * ★ 本页不提供独立的「创建出运单」按钮（出运必须来自具体销售订单）。
 * 冻结边界：仅 keyword + status + 分页；状态只读；不提供出运状态流转与删除（后端 PUT/DELETE 不在本阶段范围）。
 */
export default function ShipmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const salesOrderId = searchParams.get('salesOrderId') ?? undefined;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<ShipmentStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [result, setResult] = useState<PageResult<ShipmentListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const autoOpenedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!salesOrderId) return;
    if (autoOpenedFor.current === salesOrderId) return;
    autoOpenedFor.current = salesOrderId;
    setCreateOpen(true);
  }, [salesOrderId]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await getShipments({
          page,
          pageSize,
          keyword: keyword || undefined,
          status: status === 'ALL' ? undefined : status,
          salesOrderId,
        });
        if (!cancelled) setResult(response);
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err));
          setResult(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, status, keyword, salesOrderId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const clearOrderFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('salesOrderId');
    setSearchParams(next, { replace: true });
    setPage(1);
    autoOpenedFor.current = null;
  }, [searchParams, setSearchParams]);

  const handleStatusChange = useCallback((value: ShipmentStatus | 'ALL') => {
    setStatus(value);
    setPage(1);
  }, []);

  const handleKeywordSubmit = useCallback((value: string) => {
    setKeyword(value.trim());
    setPage(1);
  }, []);

  const handlePaginationChange = useCallback(
    (nextPage: number, nextPageSize: number) => {
      if (nextPageSize !== pageSize) {
        setPageSize(nextPageSize);
        setPage(1);
        return;
      }
      setPage(nextPage);
    },
    [pageSize],
  );

  const rows = result?.list ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Space size={12} align="center">
          <Title level={4} style={{ margin: 0 }}>
            出运管理
          </Title>
          {salesOrderId ? <Button onClick={clearOrderFilter}>清除订单筛选</Button> : null}
        </Space>
        <div>
          <Text type="secondary">出运单由销售订单发起（订单详情 →「创建出运单」）；出运数量受订单行可出运数量约束</Text>
        </div>
      </div>

      <Space size={12} wrap>
        <Input
          allowClear
          style={{ width: 260 }}
          placeholder="出运单号 / 跟踪号 / 订单号"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onPressEnter={() => handleKeywordSubmit(keywordInput)}
          onBlur={() => handleKeywordSubmit(keywordInput)}
        />
        <Select
          style={{ width: 160 }}
          value={status}
          options={SHIPMENT_STATUS_FILTER_OPTIONS}
          onChange={(value) => handleStatusChange(value as ShipmentStatus | 'ALL')}
        />
        <Text type="secondary">{SHIPMENT_STATUS_HINT}</Text>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载出运单列表失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <ShipmentTable
          rows={rows}
          loading={loading}
          pagination={{
            current: result ? result.page : page,
            pageSize: result ? result.pageSize : pageSize,
            total: result ? result.total : 0,
            onChange: handlePaginationChange,
          }}
        />
      </Card>

      <ShipmentFormModal
        open={createOpen}
        salesOrderId={salesOrderId}
        onCancel={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          reload();
        }}
      />
    </div>
  );
}
