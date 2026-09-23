import { Alert, Button, Card, Input, Space, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getOpportunities } from '../../../api/sales';
import { getErrorMessage } from '../../../api/request';
import type { PageResult } from '../../../types/masterData';
import type { OpportunityListItem } from '../../../types/sales';
import { DEFAULT_PAGE_SIZE } from './constants';
import OpportunityFormModal from './OpportunityFormModal';
import OpportunityTable from './OpportunityTable';

const { Title, Text } = Typography;

/**
 * 商机列表页（Round F-S2 · Opportunity MVP UI）
 *
 * 数据流：页面 state → api/sales.ts → 后端（**后端负责数据范围与分页**，前端不做过滤/排序）
 * 路由：/sales/opportunities（与菜单项 `sales:opportunities` 的 path 同源）
 *
 * 入口协议（F-S2-D）：客户详情「新建商机」→ `/sales/opportunities?customerId=<id>` ⇒ 本页自动打开
 * 创建弹窗并**锁定该客户**（不可更换）；关闭/保存后清除该参数，避免刷新反复弹窗。
 *
 * 冻结边界（F-S2）：
 *   · 只做 List / Create / Edit / Detail —— **不做**删除、批量删除、看板、Excel 导入、指派、
 *     报价 / 订单 / 出运 / 收款（均属 OUT OF SCOPE）。
 *   · 筛选只使用后端真实支持的 keyword（title / 客户名 contains）；阶段 / 负责人 / 日期区间筛选不在 MVP 范围。
 *   · 查询状态（page / pageSize / keyword）保存在组件 state（未同步 URL），仅 customerId 使用 URL
 *     —— 因它是跨页面的入口协议。
 */
export default function OpportunityListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const presetCustomerId = searchParams.get('customerId');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');

  const [result, setResult] = useState<PageResult<OpportunityListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // 入口协议：URL 带 customerId ⇒ 自动打开创建弹窗（客户预置并锁定）
  useEffect(() => {
    if (presetCustomerId) setCreateOpen(true);
  }, [presetCustomerId]);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await getOpportunities({ page, pageSize, keyword: keyword || undefined });
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
  }, [page, pageSize, keyword, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /** 关闭创建弹窗：同时清除 customerId 入口参数（避免刷新后反复弹窗） */
  const closeCreate = useCallback(() => {
    setCreateOpen(false);
    if (presetCustomerId) {
      const next = new URLSearchParams(searchParams);
      next.delete('customerId');
      setSearchParams(next, { replace: true });
    }
  }, [presetCustomerId, searchParams, setSearchParams]);

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
            商机管理
          </Title>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建商机
          </Button>
        </Space>
        <div>
          <Text type="secondary">销售商机：客户 → 商机 → 产品；阶段由关联单据自动推导</Text>
        </div>
      </div>

      <Space size={12} wrap>
        <Input
          allowClear
          style={{ width: 260 }}
          placeholder="商机名称 / 客户名称"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onPressEnter={() => handleKeywordSubmit(keywordInput)}
          onBlur={() => handleKeywordSubmit(keywordInput)}
        />
        <Text type="secondary">关键词按 Enter 或失焦后查询</Text>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载商机列表失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <OpportunityTable
          rows={rows}
          loading={loading}
          onEdit={(opportunity) => setEditingId(opportunity.id)}
          pagination={{
            current: result ? result.page : page,
            pageSize: result ? result.pageSize : pageSize,
            total: result ? result.total : 0,
            onChange: handlePaginationChange,
          }}
        />
      </Card>

      <OpportunityFormModal
        mode="create"
        open={createOpen}
        presetCustomer={presetCustomerId ? { id: presetCustomerId } : null}
        onCancel={closeCreate}
        onSaved={() => {
          closeCreate();
          reload();
        }}
      />

      <OpportunityFormModal
        mode="edit"
        open={editingId !== null}
        opportunityId={editingId ?? undefined}
        onCancel={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          reload();
        }}
      />
    </div>
  );
}
