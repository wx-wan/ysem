import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button, Space, Input, Select,
  Tag, App, Card, Row, Col, Pagination, Spin, Tooltip, Table, Typography, Grid, Dropdown,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined,
  UploadOutlined, InfoCircleOutlined, DownOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import productApi, {
  Product, ProductCraft, ProductAudience, ProductCategory, ProductActivity,
  MixedItem, taxonomyApi, productGroupApi,
} from '../api/products';
import { userApi } from '../api/users';
import { salesApi, SalesItem } from '../api/sales';
import { buildTablePagination } from '../components/common/tablePagination';
import { useCardGutter } from '../components/common/tokens';
import ViewModeSwitch from '../components/common/ViewModeSwitch';
import ProductList from '../components/product/list/ProductList';
import ProductCard from '../components/product/cards/ProductCard';
import ProductGroupCard from '../components/product/cards/ProductGroupCard';
import ProductGroupManageModal from '../components/product/ProductGroupManageModal';
import { useAuthStore } from '../stores/useAuthStore';
import ProductDetailModal from '../components/product/modals/ProductDetailModal';
import ProductImportModal from '../components/product/modals/ProductImportModal';
import { ProductEditModal, ProductEditModalHandle } from '../components/product/modals/ProductEditModal';
import {
  listCacheKey, getListCache, setListCache,
  setDetailCache, installCacheLifecycle, invalidateAll,
} from '../utils/productCache';

const { Text } = Typography;

// 类名拼接工具
const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export default function Products() {
  const { t } = useTranslation();
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
  // 用户列表（用于「不公开」产品指定可见人）
  const [users, setUsers] = useState<{ id: string; username: string; realName?: string }[]>([]);
  const userMap = useMemo(
    () => Object.fromEntries(users.map((u) => [u.id, u])),
    [users],
  );

  // 分类下拉数据
  const [crafts, setCrafts] = useState<ProductCraft[]>([]);
  const [audiences, setAudiences] = useState<ProductAudience[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [selectedAudienceId, setSelectedAudienceId] = useState<string | undefined>();

  const [detailOpen, setDetailOpen] = useState(false);
  const [viewing, setViewing] = useState<Product | null>(null);
  const [salesList, setSalesList] = useState<SalesItem[]>([]);
  const [salesLoading, setSalesLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  // 当前用户角色 → 供货模式可选范围（admin 全选 / purchaser 轻定制+现货 / 其他默认深度定制）
  const { user: currentUser } = useAuthStore();
  const roleCode = currentUser?.role?.code ?? '';
  const canDelete = roleCode === 'admin' || roleCode === 'ADMIN';

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
  }, [page, pageSize, keyword, filterCraftId, filterAudienceId, filterVisibility]);

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
  // 改变任意筛选即重新查询（关键词在失焦时写入，故此处即时查询）
  useEffect(() => { fetchList(); }, [page, keyword, filterCraftId, filterAudienceId, filterVisibility]);

  // Excel 导入弹窗
  const [importOpen, setImportOpen] = useState(false);
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
      {/* 筛选栏 */}
      <Card className="pm-toolbar" styles={{ body: { padding: '12px 16px' } }}>
        <Row gutter={12} align="middle" wrap>
          <Col flex="auto">
            <Space wrap>
              <Input
                placeholder="搜索产品名称 / SKU"
                prefix={<SearchOutlined />}
                value={kwInput}
                onChange={(e) => {
                  setKwInput(e.target.value);
                  if (e.target.value === '') setKeyword('');
                }}
                onBlur={(e) => setKeyword(e.target.value.trim())}
                allowClear
                style={{ width: 260 }}
              />
              <Select
                placeholder="工艺"
                value={filterCraftId}
                onChange={(v) => { setFilterCraftId(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={crafts.map((c) => ({ label: c.name, value: c.id }))}
              />
              <Select
                placeholder="受众"
                value={filterAudienceId}
                onChange={(v) => { setFilterAudienceId(v); setPage(1); }}
                allowClear
                style={{ width: 110 }}
                options={audiences.map((a) => ({ label: a.name, value: a.id }))}
              />
              <Select
                placeholder={t('product.visibility')}
                value={filterVisibility}
                onChange={(v) => { setFilterVisibility(v); setPage(1); }}
                allowClear
                style={{ width: 120 }}
                options={[
                  { label: t('product.visibilityPublic'), value: 'PUBLIC' },
                  { label: t('product.visibilityPrivate'), value: 'PRIVATE' },
                ]}
              />
            </Space>
          </Col>
          <Col>
            <Space>
              <ViewModeSwitch value={viewMode} onChange={setViewMode} />
              <Dropdown
                menu={{
                  items: [
                    { key: 'create', icon: <PlusOutlined />, label: '新建产品' },
                    { key: 'import', icon: <UploadOutlined />, label: 'Excel 导入' },
                  ],
                  onClick: ({ key }) => {
                    if (key === 'create') editModalRef.current?.open();
                    else setImportOpen(true);
                  },
                }}
              >
                <Button type="primary" icon={<PlusOutlined />}>
                  新建 <DownOutlined />
                </Button>
              </Dropdown>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 产品 / 组合 混合数据区（同列表混排） */}
      <Card className="pm-grid-card" styles={{ body: { padding: 20 } }}>
        {loading ? (
          <div style={{ padding: '64px 0', textAlign: 'center' }}>
            <Spin size="large" />
          </div>
        ) : list.length === 0 ? (
          <div className="pm-grid-empty">暂无数据，点击右上角「新建」开始添加</div>
        ) : viewMode === 'card' ? (
          <>
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
            <div className="pm-grid-pager">
              <Pagination
                {...buildTablePagination({
                  total,
                  page,
                  pageSize: 8,
                  onChange: (p) => setPage(p),
                })}
              />
            </div>
          </>
        ) : (
          <ProductList
            data={list.filter((i) => i.type === 'PRODUCT').map((i) => (i as { type: 'PRODUCT'; data: Product }).data)}
            total={total}
            page={page}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            onView={(r) => openDetail(r)}
            onEdit={(r) => editModalRef.current?.open(r)}
            onDelete={handleDelete}
            canDelete={canDelete}
          />
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
        activities={viewing?.activities || []}
        userMap={userMap}
        onSalesRefresh={() => viewing && loadSalesList(viewing.id)}
      />

      {/* Excel 导入产品 */}
      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { setImportOpen(false); fetchList(); }}
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
