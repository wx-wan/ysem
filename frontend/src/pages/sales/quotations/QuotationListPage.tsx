import { Alert, Button, Card, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getQuotations } from '../../../api/quotations';
import { getErrorMessage } from '../../../api/request';
import type { PageResult } from '../../../types/masterData';
import type { QuotationListItem, QuotationStatus } from '../../../types/quotation';
import { DEFAULT_PAGE_SIZE, LIST_FILTER_NOTE, QUOTATION_STATUS_FILTER_OPTIONS } from './constants';
import QuotationFormModal from './QuotationFormModal';
import QuotationTable from './QuotationTable';

const { Title, Text } = Typography;

/**
 * 报价列表页（Round F-S3 · Quotation MVP）
 *
 * 数据流：页面 state / URL → api/quotations.ts → 后端（**后端负责数据范围与分页**，前端不做过滤/排序）
 * 路由：/sales/quotes（与菜单项 `sales:quotes` 的 path 同源）
 *
 * 入口协议（D-FS3-001 / D-FS3-002）：商机详情「新建报价」→ `/sales/quotes?opportunityId=<id>`
 *   ⇒ 本页自动打开创建弹窗（商机锁定），并把该 opportunityId 作为列表筛选条件（便于看到该商机的全部报价）。
 *   同一 opportunityId 只自动弹出一次（关闭后不重复弹出，避免刷新反复弹窗）。
 *
 * 冻结边界（F-S3）：
 *   · 只做 List / Create / Edit / Detail —— **不做**删除、状态流转、版本升级、审批、归属指派。
 *   · ★ **无关键词搜索**：后端 `GET /api/quotations` 不支持 keyword ⇒ 前端不实现、不用「先取 N 条再前端过滤」伪造。
 *   · 筛选仅使用后端真实参数：status（+ 入口带入的 opportunityId）。
 *   · 列表状态（page / pageSize / status）保存在组件 state；仅 opportunityId 走 URL（跨页面入口协议）。
 */
export default function QuotationListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const opportunityId = searchParams.get('opportunityId') ?? undefined;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [status, setStatus] = useState<QuotationStatus | 'ALL'>('ALL');

  const [result, setResult] = useState<PageResult<QuotationListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);

  /** 已自动弹窗过的 opportunityId（同一入口参数只弹一次） */
  const autoOpenedFor = useRef<string | null>(null);

  // 入口协议：URL 带 opportunityId ⇒ 自动打开创建弹窗（商机预置并锁定），仅一次
  useEffect(() => {
    if (!opportunityId) return;
    if (autoOpenedFor.current === opportunityId) return;
    autoOpenedFor.current = opportunityId;
    setCreateOpen(true);
  }, [opportunityId]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await getQuotations({
          page,
          pageSize,
          status: status === 'ALL' ? undefined : status,
          opportunityId,
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
  }, [page, pageSize, status, opportunityId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const clearOpportunityFilter = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('opportunityId');
    setSearchParams(next, { replace: true });
    setPage(1);
    autoOpenedFor.current = null;
  }, [searchParams, setSearchParams]);

  const handleStatusChange = useCallback((value: QuotationStatus | 'ALL') => {
    setStatus(value);
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
            报价管理
          </Title>
          {opportunityId ? (
            <Button onClick={clearOpportunityFilter}>清除商机筛选</Button>
          ) : null}
        </Space>
        <div>
          <Text type="secondary">销售报价：由商机发起，明细取自商机产品并可调整数量与报价单价</Text>
        </div>
      </div>

      <Space size={12} wrap>
        <Select
          style={{ width: 160 }}
          value={status}
          options={QUOTATION_STATUS_FILTER_OPTIONS}
          onChange={(value) => handleStatusChange(value as QuotationStatus | 'ALL')}
        />
        {opportunityId ? <Text type="secondary">已按商机筛选</Text> : null}
        <Text type="secondary">{LIST_FILTER_NOTE}</Text>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载报价列表失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <QuotationTable
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

      {/* 编辑入口在报价详情页（列表仅提供「查看」）—— 避免列表/详情两处重复编辑入口 */}
      <QuotationFormModal
        mode="create"
        open={createOpen}
        opportunityId={opportunityId}
        onCancel={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          reload();
        }}
      />
    </div>
  );
}
