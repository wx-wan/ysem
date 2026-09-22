import { Alert, Button, Card, Input, Select, Space, Typography } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { getProducts } from '../../api/products';
import { getErrorMessage } from '../../api/request';
import type { PageResult } from '../../types/masterData';
import type { ProductListItem, ProductVisibility } from '../../types/product';
import { DEFAULT_PAGE_SIZE, VISIBILITY_FILTER_OPTIONS } from './constants';
import ProductFormModal from './ProductFormModal';
import ProductTable from './ProductTable';

const { Title, Text } = Typography;

/**
 * 产品列表页（Round F-S1 · Product MVP UI）
 *
 * 数据流：页面 state → api/products.ts → 后端（**后端负责可见性与分页**，前端不做任何过滤/排序）
 *
 * 冻结边界（F-S1）：
 *   · 只做 List / Create / Edit / Select —— **不做**删除、导入导出、工艺/证书/组合管理、
 *     客户专属价、复杂价格体系、高级筛选、统计（均属 OUT OF SCOPE）。
 *   · 筛选只使用后端真实支持的参数：keyword（name/sku contains）与 visibility。
 *   · 查询状态保存在组件 state（**未**同步到 URL）—— 与 Customer 页的 URL 方案不同，
 *     属本阶段的刻意简化（MVP 不要求可分享/可刷新恢复的查询串）。
 */
export default function ProductListPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [keyword, setKeyword] = useState('');
  const [keywordInput, setKeywordInput] = useState('');
  const [visibility, setVisibility] = useState<ProductVisibility | 'ALL'>('ALL');

  const [result, setResult] = useState<PageResult<ProductListItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await getProducts({
          page,
          pageSize,
          keyword: keyword || undefined,
          visibility: visibility === 'ALL' ? undefined : visibility,
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
  }, [page, pageSize, keyword, visibility, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const handleKeywordSubmit = useCallback((value: string) => {
    setKeyword(value.trim());
    setPage(1);
  }, []);

  const handleVisibilityChange = useCallback((value: ProductVisibility | 'ALL') => {
    setVisibility(value);
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
            产品管理
          </Title>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新建产品
          </Button>
        </Space>
        <div>
          <Text type="secondary">产品主数据：销售链路（商机 / 报价 / 订单）选择的标准产品</Text>
        </div>
      </div>

      <Space size={12} wrap>
        <Input
          allowClear
          style={{ width: 240 }}
          placeholder="产品名称 / SKU"
          value={keywordInput}
          onChange={(event) => setKeywordInput(event.target.value)}
          onPressEnter={() => handleKeywordSubmit(keywordInput)}
          onBlur={() => handleKeywordSubmit(keywordInput)}
        />
        <Select
          style={{ width: 160 }}
          value={visibility}
          options={VISIBILITY_FILTER_OPTIONS}
          onChange={(value) => handleVisibilityChange(value as ProductVisibility | 'ALL')}
        />
        <Text type="secondary">关键词按 Enter 或失焦后查询</Text>
      </Space>

      {error ? (
        <Alert
          type="error"
          showIcon
          title="加载产品列表失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重新加载
            </Button>
          }
        />
      ) : null}

      <Card size="small" styles={{ body: { padding: 0 } }}>
        <ProductTable
          rows={rows}
          loading={loading}
          onEdit={(product) => setEditingId(product.id)}
          pagination={{
            current: result ? result.page : page,
            pageSize: result ? result.pageSize : pageSize,
            total: result ? result.total : 0,
            onChange: handlePaginationChange,
          }}
        />
      </Card>

      <ProductFormModal
        mode="create"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          reload();
        }}
      />

      <ProductFormModal
        mode="edit"
        open={editingId !== null}
        productId={editingId ?? undefined}
        onCancel={() => setEditingId(null)}
        onSaved={() => {
          setEditingId(null);
          reload();
        }}
      />
    </div>
  );
}
