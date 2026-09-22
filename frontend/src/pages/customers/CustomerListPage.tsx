import { Alert, Button, Card, Segmented, Space, Tag, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getAllCustomers, getMyCustomers, getPublicCustomers } from '../../api/customers';
import { getErrorMessage } from '../../api/request';
import { useDataScope } from '../../auth/useDataScope';
import { usePermission } from '../../auth/usePermission';
import type {
  CustomerAllResponse,
  CustomerListType,
  CustomerMyResponse,
  CustomerPublicResponse,
} from '../../types/customer';
import CustomerFilterBar from './CustomerFilterBar';
import CustomerFormModal from './CustomerFormModal';
import CustomerStats from './CustomerStats';
import CustomerTable, { toDisplayRow, toDisplayRowWithPipeline, type CustomerDisplayRow } from './CustomerTable';
import {
  ADMIN_VIEWS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_VIEW,
  NON_ADMIN_VIEWS,
  PAGE_SIZE_OPTIONS,
  VALID_TYPES,
  VIEW_FILTER_CAPABILITY,
  VIEW_OPTIONS,
  getViewLabel,
  isViewMode,
  type CustomerViewMode,
} from './constants';

const { Title, Text } = Typography;

/** 三个端点的响应按视图区分（判别联合 ⇒ TS 精确收窄，无 any） */
type CustomerListResult =
  | { view: 'my'; response: CustomerMyResponse }
  | { view: 'public'; response: CustomerPublicResponse }
  | { view: 'all'; response: CustomerAllResponse };

const parsePositiveInt = (raw: string | null, fallback: number): number => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : fallback;
};

/**
 * 同一查询的 in-flight 去重（模块级，跨组件重挂载生效）。
 *
 * 动机：React StrictMode 在开发环境会执行 effect 两次 ⇒ 若不共享 in-flight promise，
 * 同一 URL 会发出两次请求（生产构建不双执行，但重复请求应被结构性消除）。
 * 这里**只合并并发中的相同请求**，请求 settle 后立即移除 —— 不是缓存（不改变 page-level 语义）。
 */
const inFlight = new Map<string, Promise<CustomerListResult>>();

const loadList = (key: string, fetcher: () => Promise<CustomerListResult>): Promise<CustomerListResult> => {
  const existing = inFlight.get(key);
  if (existing) return existing;
  const task = fetcher().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
};

/**
 * 客户列表页（Round F-6）
 *
 * 数据流（§17 / §33）：
 *   URL(useSearchParams) → 本页 state → F-5 API → 后端（**由 server 负责数据范围**，前端不过滤客户）
 *
 * 明确不做：Customer Detail / Create / Edit / Delete / Claim / Release / Transfer / Tags / Import、
 * owner 筛选与 owner 选择器（F-01 冻结 ⇒ owner 指派 BLOCKED）、任何写请求。
 * 视图可见性（admin 才有「全部客户」）是 **UI 视图选择**，不是安全授权 —— 后端始终是最终权威。
 */
export default function CustomerListPage() {
  const { isAdmin } = usePermission();
  const { dataScope } = useDataScope();
  const [searchParams, setSearchParams] = useSearchParams();

  const allowedViews = isAdmin ? ADMIN_VIEWS : NON_ADMIN_VIEWS;

  // ---------- URL state（刷新可恢复；view 非法或越权时回落到默认视图） ----------
  const rawView = searchParams.get('view');
  const view: CustomerViewMode = isViewMode(rawView) && allowedViews.includes(rawView) ? rawView : DEFAULT_VIEW;
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const rawPageSize = parsePositiveInt(searchParams.get('pageSize'), DEFAULT_PAGE_SIZE);
  const pageSize = PAGE_SIZE_OPTIONS.includes(rawPageSize) ? rawPageSize : DEFAULT_PAGE_SIZE;
  const keyword = searchParams.get('keyword') ?? '';
  const country = searchParams.get('country') ?? undefined;
  const rawType = searchParams.get('type');
  const type: CustomerListType | undefined =
    rawType && VALID_TYPES.includes(rawType as CustomerListType) ? (rawType as CustomerListType) : undefined;

  const [result, setResult] = useState<CustomerListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const patchParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // 切换视图：page=1，并丢弃目标视图不支持的筛选（/public 无 type）
  const handleViewChange = useCallback(
    (next: CustomerViewMode) => {
      const patch: Record<string, string | undefined> = { view: next, page: '1' };
      if (!VIEW_FILTER_CAPABILITY[next].type) patch.type = undefined;
      patchParams(patch);
    },
    [patchParams],
  );

  const handleKeywordSubmit = useCallback((value: string) => patchParams({ keyword: value, page: '1' }), [patchParams]);
  const handleCountryChange = useCallback((value?: string) => patchParams({ country: value, page: '1' }), [patchParams]);
  const handleTypeChange = useCallback((value?: CustomerListType) => patchParams({ type: value, page: '1' }), [patchParams]);

  const handlePaginationChange = useCallback(
    (nextPage: number, nextPageSize: number) => {
      const pageChanged = nextPageSize !== pageSize;
      patchParams({ page: String(pageChanged ? 1 : nextPage), pageSize: String(nextPageSize) });
    },
    [pageSize, patchParams],
  );

  // ---------- 取数（视图切换 / 筛选 / 分页 / 重新加载触发） ----------
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      const signature = JSON.stringify([view, page, pageSize, keyword, country, type]);
      try {
        const next = await loadList(signature, async (): Promise<CustomerListResult> => {
          if (view === 'public') {
            const response = await getPublicCustomers({ page, pageSize, keyword: keyword || undefined, country });
            return { view: 'public', response };
          }
          if (view === 'all') {
            const response = await getAllCustomers({ page, pageSize, keyword: keyword || undefined, country, type });
            return { view: 'all', response };
          }
          const response = await getMyCustomers({ page, pageSize, keyword: keyword || undefined, country, type });
          return { view: 'my', response };
        });
        if (!cancelled) setResult(next);
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
  }, [view, page, pageSize, keyword, country, type, reloadToken]);

  const rows: CustomerDisplayRow[] = useMemo(() => {
    if (!result) return [];
    if (result.view === 'public') return result.response.list.map((item) => toDisplayRow(item));
    return result.response.list.map((item) => toDisplayRowWithPipeline(item));
  }, [result]);

  const showPipelineAmount = result?.view === 'my' || result?.view === 'all';
  const showTypeFilter = VIEW_FILTER_CAPABILITY[view].type;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Space size={12} align="center">
          <Title level={4} style={{ margin: 0 }}>
            客户管理
          </Title>
          <Tag>{getViewLabel(view)}</Tag>
          <Tag color="default">dataScope：{dataScope}</Tag>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建客户
          </Button>
        </Space>
        <div>
          <Text type="secondary">客户关系与销售归属管理</Text>
        </div>
      </div>

      <Segmented
        value={view}
        onChange={(value) => handleViewChange(value as CustomerViewMode)}
        options={VIEW_OPTIONS.filter((option) => allowedViews.includes(option.value)).map((option) => ({
          label: option.label,
          value: option.value,
        }))}
      />

      <CustomerFilterBar
        keyword={keyword}
        country={country}
        type={type}
        showType={showTypeFilter}
        onKeywordSubmit={handleKeywordSubmit}
        onCountryChange={handleCountryChange}
        onTypeChange={handleTypeChange}
      />

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载客户列表失败"
          description={error}
          action={
            <Button size="small" onClick={() => setReloadToken((t) => t + 1)}>
              重新加载
            </Button>
          }
        />
      ) : null}

      {/* 统计：仅当响应真实包含 stats 时渲染（/public 无 stats ⇒ 不渲染、不伪造 0） */}
      {result?.view === 'my' ? <CustomerStats kind="my" stats={result.response.stats} /> : null}
      {result?.view === 'all' ? (
        <CustomerStats
          kind="all"
          stats={result.response.stats}
          ownerStats={result.response.ownerStats}
          publicCount={result.response.publicCount}
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <CustomerTable
          rows={rows}
          loading={loading}
          showPipelineAmount={showPipelineAmount}
          pagination={{
            current: result ? result.response.page : page,
            pageSize: result ? result.response.pageSize : pageSize,
            total: result ? result.response.total : 0,
            onChange: handlePaginationChange,
          }}
        />
      </Card>

      {/* F-8：新建客户（Create contract —— 不含 customerLevel / firstOrderAt 等） */}
      <CustomerFormModal
        mode="create"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          setReloadToken((t) => t + 1);
        }}
      />
    </div>
  );
}
