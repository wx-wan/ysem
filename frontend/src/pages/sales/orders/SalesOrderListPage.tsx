import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getSalesOrders } from '../../../api/salesOrders';
import { getErrorMessage } from '../../../api/request';
import type { PageResult } from '../../../types/masterData';
import type { SalesOrderListItem, SalesOrderStatus } from '../../../types/salesOrder';
import { DEFAULT_PAGE_SIZE, LIST_FILTER_NOTE, OWNER_HINT, ORDER_STATUS_FILTER_OPTIONS } from './constants';
import SalesOrderFormModal from './SalesOrderFormModal';
import SalesOrderTable from './SalesOrderTable';

const { Title, Text } = Typography;

/**
 * 销售订单列表页（Round F-S4）
 *
 * 数据流：页面 state / URL → api/salesOrders.ts → 后端（**后端负责 scope 与分页**）
 * 路由：/sales/orders（与菜单项 `sales:orders` 同源）
 *
 * 入口协议（D-FS4-002）：**唯一创建入口** = 报价详情「创建销售订单」→ `/sales/orders?quotationId=<id>`
 *   ⇒ 本页自动打开创建弹窗（一次），并把 quotationId 作为列表筛选条件。
 * ★ **本页不提供「创建订单」按钮**（不得存在第二个入口）。
 *
 * 冻结边界：仅 keyword + status + 分页（D-FS4-016）；不展示负责人（D-FS4-018）；
 * 不做删除（D-FS4-023）；不做状态流转（D-FS4-014）。
 */
export default function SalesOrderListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const quotationId = searchParams.get('quotationId') ?? undefined;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<SalesOrderStatus | 'ALL'>('ALL');
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [result, setResult] = useState<PageResult<SalesOrderListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const autoOpenedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!quotationId) return;
    if (autoOpenedFor.current === quotationId) return;
    autoOpenedFor.current = quotationId;
    setCreateOpen(true);
  }, [quotationId]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await getSalesOrders({
          page,
          pageSize,
          keyword: keyword || undefined,
          status: status === 'ALL' ? undefined : status,
          quotationId,
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
  }, [page, pageSize, status, keyword, quotationId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const clearQuotationFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('quotationId');
    setSearchParams(next, { replace: true });
    setPage(1);
    autoOpenedFor.current = null;
  }, [searchParams, setSearchParams]);

  const handleStatusChange = useCallback((value: SalesOrderStatus | 'ALL') => {
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
            销售订单
          </Title>
          {quotationId ? <Button onClick={clearQuotationFilter}>清除报价筛选</Button> : null}
        </Space>
        <div>
          <Text type="secondary">
            订单由报价发起（报价详情 →「创建销售订单」）；创建后状态为「已确认」，可直接进入出运环节
          </Text>
        </div>
      </div>

      <Space size={12} wrap>
        <Input
          allowClear
          style={{ width: 260 }}
          placeholder="订单号 / 客户名称"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onPressEnter={() => handleKeywordSubmit(keywordInput)}
          onBlur={() => handleKeywordSubmit(keywordInput)}
        />
        <Select
          style={{ width: 160 }}
          value={status}
          options={ORDER_STATUS_FILTER_OPTIONS}
          onChange={(value) => handleStatusChange(value as SalesOrderStatus | 'ALL')}
        />
        <Text type="secondary">{LIST_FILTER_NOTE}</Text>
        <Text type="secondary">{OWNER_HINT}</Text>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载销售订单列表失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <SalesOrderTable
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

      <SalesOrderFormModal
        mode="create"
        open={createOpen}
        quotationId={quotationId}
        onCancel={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          reload();
        }}
      />
    </div>
  );
}
