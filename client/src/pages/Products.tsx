import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  App, Card, Row, Col, Pagination, Select, Spin, Empty, theme,
} from 'antd';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory, ProductActivity,
  MixedItem, taxonomyApi, productGroupApi,
} from '../api/products';
import { salesApi, ProductOpportunityItem } from '../api/sales';
import { buildTablePagination } from '../components/common/tablePagination';
import { useCardGutter } from '../components/common/tokens';
import FilterToolbar, { FilterGroup } from '../components/common/FilterToolbar';
import CapsuleSwitch from '../components/common/CapsuleSwitch';
import ProductCard from '../components/product/cards/ProductCard';
import ProductGroupCard from '../components/product/cards/ProductGroupCard';
import ProductGroupManageModal from '../components/product/ProductGroupManageModal';
import { useAuthStore } from '../stores/useAuthStore';
import { usePermission } from '../hooks/usePermission';
import ProductDetailModal from '../components/product/modals/ProductDetailModal';
import { ProductEditModal, ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import { debounce } from '../utils/rateLimit';
import {
  listCacheKey, getListCache, setListCache,
  setDetailCache, installCacheLifecycle, invalidateAll,
} from '../utils/productCache';

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export default function Products() {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const cardGutter = useCardGutter();
  const [list, setList] = useState<MixedItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(6);
  const [loading, setLoading] = useState(false);

  // 筛选
  const [keyword, setKeyword] = useState('');
  const [kwInput, setKwInput] = useState('');
  const navigate = useNavigate();
  const [filterCraftId, setFilterCraftId] = useState<string | undefined>();
  const [filterAudienceId, setFilterAudienceId] = useState<string | undefined>();
  const [filterVisibility, setFilterVisibility] = useState<string | undefined>();
  // 排序：默认按创建时间倒序（与后端混排默认一致），可切换升序
  const [sort, setSort] = useState<'createdAt:desc' | 'createdAt:asc'>('createdAt:desc');

  // 分类下拉数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [salesList, setSalesList] = useState<ProductOpportunityItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);

  // 关键词搜索：本地输入态即时回显，防抖提交（与线索页一致，避免逐字触发请求）
  const commitKeyword = useMemo(
    () => debounce((v: string) => { setKeyword(v); setPage(1); }, 400),
    [],
  );

  // 是否存在搜索 / 筛选条件（仅用于空态文案区分）
  const hasActiveFilter = !!(keyword || filterCraftId || filterAudienceId || filterVisibility);

  // 删除产品：按**按钮级权限**判定（系统设置 → 权限管理 → 产品管理 → 产品删除），
  // admin 由 usePermission 内置放行 —— 不再按角色硬编码，授权后业务员同样可删。
  const { hasPerm } = usePermission();
  const canDelete = hasPerm('product:delete');

  // 编辑/新建弹窗（独立组件，命令式 ref 调用；关闭或保存成功后刷新列表）
  const editModalRef = useRef<ProductEditModalHandle>(null);

  // 详情弹窗层级：关闭时若详情栈空则刷新列表
  const modalStack = useRef<('detail')[]>([]);
  const pushLayer = (layer: 'detail') => {
    if (!modalStack.current.includes(layer)) modalStack.current.push(layer);
  };
  const popLayer = (layer: 'detail') => {
    modalStack.current = modalStack.current.filter((l) => l !== layer);
    if (modalStack.current.length === 0) fetchList();
  };
  const closeDetail = () => { popLayer('detail'); setDetailOpen(false); };

  // 加载当前查看产品的销售记录（商机）
  const loadSalesList = useCallback((productId: string) => {
    setSalesLoading(true);
    salesApi.listByProduct(productId)
      .then((res) => {
        if (res.data?.data?.list) setSalesList(res.data.data.list);
        else setSalesList([]);
      })
      .catch(() => setSalesList([]))
      .finally(() => setSalesLoading(false));
  }, []);

  // 打开产品详情：重置 Tab、拉取完整产品（含操作记录）并加载销售记录
  const openDetail = (r: Product) => {
    setViewing(r);
    pushLayer('detail');
    setDetailOpen(true);
    // 拉取完整产品详情，确保 activities（操作记录）等字段齐全
    productApi.getById(r.id)
      .then((res) => {
        const full = (res.data as any)?.data ?? res.data;
        if (full) setViewing(full);
      })
      .catch(() => {});
    loadSalesList(r.id);
  };

  const fetchList = useCallback(async () => {
    const query = {
      page, pageSize, keyword: keyword || undefined,
      craftIds: filterCraftId,
      audienceId: filterAudienceId,
      visibility: filterVisibility,
      sort,
    };
    const key = listCacheKey(query);
    const cached = getListCache(key);
    if (cached) {
      setList(cached.list);
      setTotal(cached.total);
      setLoading(false);
      // 缓存命中后仍在后台静默回源，保证数据新鲜
      Promise.resolve().then(async () => {
        try {
          const res = await productApi.getMixed(query);
          if (res.data.code === 200 || res.data.code === 0) {
            setListCache(key, { list: res.data.data.list, total: res.data.data.total });
            setList(res.data.data.list);
            setTotal(res.data.data.total);
          }
        } catch { /* 静默 */ }
      });
      return;
    }

    setLoading(true);
    try {
      const res = await productApi.getMixed(query);
      if (res.data.code === 200 || res.data.code === 0) {
        setListCache(key, { list: res.data.data.list, total: res.data.data.total });
        setList(res.data.data.list);
        setTotal(res.data.data.total);
      }
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, pageSize, keyword, filterCraftId, filterAudienceId, filterVisibility, sort]);

  const fetchTaxonomy = async () => {
    try {
      const [cRes, aRes] = await Promise.all([
        taxonomyApi.getCrafts(),
        taxonomyApi.getAudiences(),
      ]);
      if (cRes.data.code === 200 || cRes.data.code === 0) setCrafts(cRes.data.data);
      if (aRes.data.code === 200 || aRes.data.code === 0) setAudiences(aRes.data.data);
    } catch {}
  };

  useEffect(() => { fetchTaxonomy(); }, []);
  useEffect(() => { installCacheLifecycle(); }, []);
  // 改变任意筛选 / 排序即重新查询（关键词在防抖提交时写入，故此处即时查询）
  useEffect(() => { fetchList(); }, [page, keyword, filterCraftId, filterAudienceId, filterVisibility, sort]);

  // 组合管理弹窗
  const [groupManageId, setGroupManageId] = useState<string | null>(null);
  const [groupManageOpen, setGroupManageOpen] = useState(false);

  const handleDelete = async (id: string) => {
    try {
      await productApi.delete(id);
      message.success('删除成功');
      invalidateAll(); // 删除后失效，下次重新拉取
      fetchList();
    } catch { message.error('删除失败'); }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await productGroupApi.remove(id);
      message.success('已删除产品组');
      fetchList();
    } catch { message.error('删除失败'); }
  };

  return (
    <div className="pm-container">
      {/* 筛选栏 + 卡片列表：同一张白色底卡片包裹（层级与线索页一致） */}
      <Card
        variant="borderless"
        style={{
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
        styles={{ body: { padding: 20 } }}
      >
        <FilterToolbar
          searchPlaceholder="搜索产品名称 / SKU"
          searchValue={kwInput}
          onSearchChange={(v) => { setKwInput(v); commitKeyword(v); }}
          onSearchSubmit={() => { setKeyword(kwInput.trim()); setPage(1); }}
          sortOptions={[
            { value: 'createdAt:desc', label: t('common.sortLatest') },
            { value: 'createdAt:asc', label: t('common.sortEarliest') },
          ]}
          sortValue={sort}
          onSortChange={(v) => { setSort(v as typeof sort); setPage(1); }}
          activeCount={(filterCraftId ? 1 : 0) + (filterAudienceId ? 1 : 0)}
          onClear={() => {
            setFilterCraftId(undefined);
            setFilterAudienceId(undefined);
            setPage(1);
          }}
          tabs={
            <CapsuleSwitch
              value={filterVisibility ?? ''}
              onChange={(key) => { setFilterVisibility(key || undefined); setPage(1); }}
              activeColor="#1677ff"
              showCount={false}
              options={[
                { key: '', label: t('common.all') },
                { key: 'PUBLIC', label: t('product.visibilityPublic') },
                { key: 'PRIVATE', label: t('product.visibilityPrivate') },
              ]}
            />
          }
          total={total}
        >
          {/* 【规则冻结】产品**不支持独立创建、不支持 Excel 导入**：
              产品只由「线索建档」路径产生（见 components/lead/LeadFormModal.tsx），
              故此处不再提供「新建产品 / Excel 导入」入口。 */}
          <FilterGroup label="工艺">
            <Select
              placeholder="全部"
              value={filterCraftId}
              onChange={(v) => { setFilterCraftId(v); setPage(1); }}
              allowClear
              style={{ width: '100%' }}
              options={crafts.map((c) => ({ label: c.name, value: c.id }))}
            />
          </FilterGroup>
          <FilterGroup label="受众">
            <Select
              placeholder="全部"
              value={filterAudienceId}
              onChange={(v) => { setFilterAudienceId(v); setPage(1); }}
              allowClear
              style={{ width: '100%' }}
              options={audiences.map((a) => ({ label: a.name, value: a.id }))}
            />
          </FilterGroup>
        </FilterToolbar>

        {/* 产品 / 组合 混合数据区（同列表混排） */}
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <div className="pm-grid-loading">
              <Spin size="large" />
            </div>
          ) : list.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ fontSize: 13, color: token.colorTextTertiary }}>
                    {hasActiveFilter ? '没有找到符合条件的产品，试试调整筛选条件' : '暂无产品数据'}
                  </span>
                }
              />
            </div>
          ) : (
            <Row gutter={[16, 16]}>
              {list.map((item) => (
                <Col key={`${item.type}-${item.data.id}`} xs={24} sm={12} md={8} lg={8} xl={8}>
                  {item.type === 'PRODUCT' ? (
                    <ProductCard
                      product={item.data}
                      onOpenDetail={openDetail}
                      onDelete={handleDelete}
                      canDelete={canDelete}
                    />
                  ) : (
                    <ProductGroupCard
                      group={item.data}
                      canDelete={canDelete}
                      onOpenManage={(g) => { setGroupManageId(g.id); setGroupManageOpen(true); }}
                      onDelete={handleDeleteGroup}
                    />
                  )}
                </Col>
              ))}
            </Row>
          )}
        </div>

        {/* 分页：记录数超出单页时才出现 */}
        {!loading && total > pageSize && (
          <div className="pm-grid-pager">
            <Pagination
              {...buildTablePagination({
                total,
                page,
                pageSize,
                onChange: (p) => setPage(p),
              })}
            />
          </div>
        )}
      </Card>

      {/* 新建 / 编辑弹窗（独立组件） */}
      <ProductEditModal
        ref={editModalRef}
        crafts={crafts}
        audiences={audiences}
        onSuccess={async (saved?: Product) => {
          fetchList();
          // 若正在查看该产品，用返回的最新数据刷新详情，避免「点击更新详情不刷新」
          if (saved?.id && viewing && saved.id === viewing.id) {
            try {
              const res = await productApi.getById(saved.id);
              const full = (res.data as any)?.data ?? res.data;
              if (full) setViewing(full);
            } catch { /* 失败则用返回体兜底 */ if (saved) setViewing(saved); }
          }
        }}
      />

      {/* 详情弹窗（使用项目自有 AppModal 组件，UI 参考客户详情） */}
      <ProductDetailModal
        product={viewing}
        open={detailOpen}
        onClose={closeDetail}
        onEdit={(r) => editModalRef.current?.open(r)}
        onDelete={() => {
          if (viewing) {
            closeDetail();
            handleDelete(viewing.id);
          }
        }}
        canDelete={canDelete}
        salesList={salesList}
        salesLoading={salesLoading}
        onSalesRefresh={() => viewing && loadSalesList(viewing.id)}
      />

      {/* 组合集中管理（成员 / 打样 / 报价 / 编辑 / 删除） */}
      <ProductGroupManageModal
        groupId={groupManageId}
        open={groupManageOpen}
        onClose={() => setGroupManageOpen(false)}
        onChanged={() => fetchList()}
      />
    </div>
  );
}
