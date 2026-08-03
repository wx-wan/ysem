import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  App, Spin, theme, Row, Col, Pagination,
} from 'antd';
import { customerApi, Customer } from '../api/customers';
import { userApi, User } from '../api/users';
import { useAuthStore } from '../stores/useAuthStore';
import { compareCustomers } from '../components/customer/shared/utils';
import { diffList } from '../utils/diff';
import {
  listCacheKey, getListCache, setListCache, invalidateAll, fetchCustomerDetail, installCacheLifecycle,
} from '../utils/customerCache';
import CustomerStats from '../components/customer/cards/CustomerStats';
import CustomerToolbar from '../components/customer/list/CustomerToolbar';
import CustomerCard from '../components/customer/cards/CustomerCard';
import CustomerList from '../components/customer/list/CustomerList';
import CustomerDetailModal from '../components/customer/modals/CustomerDetailModal';
import CustomerFormModal from '../components/customer/modals/CustomerFormModal';
import TransferModal from '../components/customer/modals/TransferModal';
import ImportModal from '../components/customer/modals/ImportModal';
import OrderFormModal from '../components/customer/modals/OrderFormModal';

export default function CustomersPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();

  // ========== 状态 ==========
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [estimatedAmount, setEstimatedAmount] = useState(0);
  const [estimatedBreakdown, setEstimatedBreakdown] = useState<any[]>([]);
  const [contractBreakdown, setContractBreakdown] = useState<any[]>([]);
  const [totalContractAmount, setTotalContractAmount] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [filterTags, setFilterTags] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'noOrder' | 'done' | 'key' | 'public'>('all');
  const [subFilterType, setSubFilterType] = useState<string>(''); // 未成交: 'A'|'B'|'C'|'D'，已成交: 'new'|'old'

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // 详情弹窗（居中大弹窗，替代抽屉）
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  // 转交
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferCustomer, setTransferCustomer] = useState<Customer | null>(null);
  const [userList, setUserList] = useState<User[]>([]);

  // 导入
  const [importOpen, setImportOpen] = useState(false);

  // 订单弹窗
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderCustomer, setOrderCustomer] = useState<Customer | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role?.code === 'admin';

  // 当前详情客户是否可操作（归属人本人 或 管理员）
  // 注：此逻辑已移至 CustomerDetailDrawer 组件内部

  const pageSize = 6;
  const API_PAGE_SIZE = 1000; // 服务端全量拉取，客户端排序分页

  // 客户端排序：采购意向 A→B→C→D → 商机金额降序 → 新客优先 → 成交金额降序 → 创建时间倒序
  // 排序规则统一收口到 shared/utils 的 compareCustomers（标签与排序逻辑一致，已不含重点/公海）
  const sortCustomers = useCallback((customers: Customer[]): Customer[] => {
    return [...customers].sort(compareCustomers);
  }, []);

  // 列表更新时自动重新排序（如切换关注状态会影响排序）
  const handleListUpdate = useCallback((updater: (prev: Customer[]) => Customer[]) => {
    setList((prev) => sortCustomers(updater(prev)));
  }, [sortCustomers]);

  // 当前页展示列表
  const displayList = useMemo(() => {
    return list.slice((page - 1) * pageSize, page * pageSize);
  }, [list, page]);

  // ========== 加载数据 ==========
  // 用 ref 读取最新 list 值，避免将 list 加入 useCallback 依赖导致无限循环：
  //   fetchData → setList → list 变化 → useCallback 重创建 → useEffect 触发 → fetchData ...
  const listRef = useRef(list);
  listRef.current = list;

  const fetchData = useCallback(async () => {
    const currentList = listRef.current;
    const params: any = { page: 1, pageSize: API_PAGE_SIZE, keyword: keyword || undefined };

    let apiType: string = filterType;
    if (filterType === 'noOrder' && subFilterType) apiType = `noOrder-${subFilterType}`;
    else if (filterType === 'done' && subFilterType) apiType = `done-${subFilterType}`;
    if (apiType !== 'all') params.type = apiType;
    if (isAdmin && selectedOwnerId && filterType !== 'public') params.ownerId = selectedOwnerId;
    if (filterTags) params.tags = filterTags;

    const cacheKey = listCacheKey(params);

    // 1) 命中前端缓存：直接复用，跳过网络请求
    const cached = getListCache(cacheKey);
    if (cached) {
      const { mergedList } = diffList(currentList, cached.list);
      setList(sortCustomers(mergedList));
      setTotal(cached.total);
      setEstimatedAmount(cached.estimatedAmount);
      setTotalContractAmount(cached.totalContractAmount);
      setEstimatedBreakdown(cached.estimatedBreakdown);
      setContractBreakdown(cached.contractBreakdown);
      return;
    }

    setLoading(true);
    try {
      const res = isAdmin
        ? await customerApi.listAll(params)
        : await customerApi.listMy(params);
      const d = res.data.data;

      const rawList: Customer[] = d.list;
      const estAmount = d.estimatedAmount || 0;
      const cntTotal = d.totalContractAmount || 0;
      const estBreakdown = d.estimatedBreakdown || [];
      const cntBreakdown = d.contractBreakdown || [];

      const sorted = sortCustomers(rawList);
      setListCache(cacheKey, {
        list: sorted,
        total: sorted.length,
        estimatedAmount: estAmount,
        totalContractAmount: cntTotal,
        estimatedBreakdown: estBreakdown,
        contractBreakdown: cntBreakdown,
      });
      const { mergedList } = diffList(currentList, sorted);
      setList(sortCustomers(mergedList));
      setTotal(sorted.length);
      setEstimatedAmount(estAmount);
      setTotalContractAmount(cntTotal);
      setEstimatedBreakdown(estBreakdown);
      setContractBreakdown(cntBreakdown);
      setPage(1);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [keyword, isAdmin, selectedOwnerId, filterType, subFilterType, filterTags, sortCustomers]);

  useEffect(() => {
    installCacheLifecycle(); // 注册「离开视图即失效」缓存生命周期（幂等）
    fetchData();
  }, [fetchData]);

  const openTransfer = useCallback((customerId: string) => {
    const found = list.find((c) => c.id === customerId);
    if (found) {
      setTransferCustomer(found);
      setTransferModalOpen(true);
    }
  }, [list]);

  // 列表项上的聚合字段（商机金额/成交金额/最后下单日期）由 list 接口计算，
  // getById（详情接口）不返回它们；合并详情数据时必须保留，否则会被清成 undefined。
  const AGG_FIELDS: (keyof Customer)[] = ['pipelineAmount', 'totalAmount', 'lastOrderDate'];

  // 用 next 覆盖 prev 的变化字段，但保留 prev 上 list 接口的聚合字段（next 没有时不清空）
  const mergeKeepAgg = useCallback((prev: Customer | null, next: Customer): Customer => {
    if (!prev || prev.id !== next.id) return next;
    const merged = { ...prev, ...next };
    for (const f of AGG_FIELDS) {
      if (next[f] === undefined) merged[f] = prev[f];
    }
    return merged;
  }, []);

  // 打开详情时（getById 异步补充完整数据）只更新弹窗自身的 detailCustomer，
  // 不要回写 list——list 中的聚合字段（商机/成交金额）由 list 接口计算，getById 不返回，
  // 回写会把它们清成 undefined，导致列表金额变化。
  const handleDetailLoaded = useCallback((loaded: Customer) => {
    setDetailCustomer((prev) => (prev && prev.id === loaded.id ? { ...prev, ...loaded } : prev));
  }, []);

  // ===== 详情弹窗：编辑保存成功后同步 UI 状态（仅更新对应项，不整页重排） =====
  const handleDetailUpdated = useCallback((updated: Customer) => {
    setDetailCustomer((prev) => (prev && prev.id === updated.id ? mergeKeepAgg(prev, updated) : prev));
    setList((prev) =>
      prev.map((item) => (item.id === updated.id ? mergeKeepAgg(item, updated) : item))
    );
    invalidateAll(); // 列表/详情缓存已过期，下次拉取回源
  }, [mergeKeepAgg]);

  // ===== 标签变更：最小化同步，只改 tags 字段，不重建整个对象（避免关联信息丢失） =====
  const handleTagsChanged = useCallback((id: string, tags: string) => {
    setDetailCustomer((prev) => (prev && prev.id === id ? { ...prev, tags } : prev));
    setList((prev) =>
      sortCustomers(prev.map((item) => (item.id === id ? { ...item, tags } : item)))
    );
  }, [sortCustomers]);

  const handleTransferFromModal = useCallback((c: Customer) => {
    setDetailModalOpen(false);
    openTransfer(c.id);
  }, [openTransfer]);

  const handleReleaseFromModal = useCallback((c: Customer) => {
    setDetailModalOpen(false);
    // TODO: 释放到公海
    message.info(`释放客户 ${c.companyName}（待接入）`);
  }, [message]);

  const handleDeleteFromModal = useCallback((c: Customer) => {
    setDetailModalOpen(false);
    // TODO: 删除客户
    message.info(`删除客户 ${c.companyName}（待接入）`);
  }, [message]);

  const openCreatePipeline = useCallback((c: Customer) => {
    setDetailModalOpen(false);
    // TODO: 新增商机（待接入）
    message.info(`新增商机 ${c.companyName}（待接入）`);
  }, [message]);

  const openCreateOrder = useCallback((customerId: string) => {
    const found = list.find((c) => c.id === customerId);
    if (found) {
      setOrderCustomer(found);
      setOrderModalOpen(true);
    }
  }, [list]);

  // 加载用户列表（用于筛选和转交）
  useEffect(() => {
    userApi.list({ pageSize: 200 }).then((res) => {
      setUserList(res.data.data?.list || []);
    }).catch(() => {});
  }, []);

  // ========== 打开详情 ==========
  // 同步打开：仅设置本地数据与显示弹窗，完整详情（owner/pipelines）由 Modal 内部
  // 通过 getById 异步补充。这样点击卡片时父组件零 async 阻塞，弹窗即时出现。
  const openDetail = useCallback((customer: Customer) => {
    setDetailCustomer(customer);
    setDetailModalOpen(true);
  }, []);

  // ========== 创建/编辑弹窗 ==========
  const openCreate = useCallback(() => {
    setEditingCustomer(null);
    setModalOpen(true);
  }, []);

  const handleOrderSuccess = useCallback(async () => {
    setOrderModalOpen(false);
    if (detailCustomer) {
      const fresh = await fetchCustomerDetail(detailCustomer.id);
      setDetailCustomer(fresh);
    }
    invalidateAll();
    fetchData();
  }, [detailCustomer, fetchData]);

  // ========== 渲染卡片视图 ==========
  const renderCardView = useMemo(() => (
    <Row gutter={[16, 16]}>
      {displayList.map((customer) => (
        <Col key={customer.id} xs={24} sm={12} md={8} lg={8} xl={8}>
          <CustomerCard
            customer={customer}
            token={token}
            onOpenDetail={openDetail}
            onListUpdate={handleListUpdate}
          />
        </Col>
      ))}
    </Row>
  ), [displayList, token, openDetail, handleListUpdate]);

  // ========== 渲染列表视图 ==========
  const renderListView = useMemo(() => (
    <CustomerList
      list={displayList}
      token={token}
      onOpenDetail={openDetail}
      onListUpdate={handleListUpdate}
    />
  ), [displayList, token, openDetail, handleListUpdate]);

  // 转交弹窗用户列表 memo
  const transferUserList = useMemo(
    () => userList.map(u => ({ id: u.id, realName: u.realName || u.username })),
    [userList]
  );



  // ========== 分页器 ==========
  const renderPagination = useMemo(() => {
    if (list.length <= pageSize) return null;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24, paddingBottom: 8 }}>
        <Pagination
          current={page}
          total={list.length}
          pageSize={pageSize}
          showSizeChanger={false}
          showQuickJumper
          showTotal={(t) => `共 ${t} 条`}
          onChange={(p) => setPage(p)}
        />
      </div>
    );
  }, [list.length, page]);

  return (
    <div style={{ padding: '0 0 24px' }}>
      <CustomerStats total={total} estimatedAmount={estimatedAmount} totalContractAmount={totalContractAmount} list={list} token={token} filterType={filterType} estimatedBreakdown={estimatedBreakdown} contractBreakdown={contractBreakdown} />

      {/* 工具栏 */}
      <CustomerToolbar
        token={token}
        keyword={keyword}
        setKeyword={setKeyword}
        fetchData={fetchData}
        setPage={setPage}
        viewMode={viewMode}
        setViewMode={setViewMode}
        filterTags={filterTags}
        setFilterTags={setFilterTags}
        filterType={filterType}
        setFilterType={setFilterType}
        subFilterType={subFilterType}
        setSubFilterType={setSubFilterType}
        setImportOpen={setImportOpen}
        openCreate={openCreate}
        isAdmin={isAdmin}
        filterTypePublic={filterType === 'public'}
        selectedOwnerId={selectedOwnerId}
        setSelectedOwnerId={setSelectedOwnerId}
        userList={userList}
      />

      {/* 内容区 */}
      <Spin spinning={loading}>
        {viewMode === 'card' ? renderCardView : renderListView}
        {list.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: 60, color: token.colorTextSecondary }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
            <div>暂无客户数据</div>
          </div>
        )}
      </Spin>

      {/* 分页 */}
      {renderPagination}

      {/* ===== 创建/编辑弹窗 ===== */}
      <CustomerFormModal
        open={modalOpen}
        editingCustomer={editingCustomer}
        onClose={() => { setModalOpen(false); setEditingCustomer(null); }}
        onSuccess={() => { invalidateAll(); fetchData(); }}
      />

      {/* ===== 转交弹窗 ===== */}
      <TransferModal
        open={transferModalOpen}
        customer={transferCustomer}
        userList={transferUserList}
        onClose={() => { setTransferModalOpen(false); setTransferCustomer(null); }}
        onSuccess={() => {
          setTransferModalOpen(false);
          setTransferCustomer(null);
          if (detailModalOpen) setDetailModalOpen(false);
          invalidateAll();
          fetchData();
        }}
      />

      {/* ===== 详情弹窗（居中大弹窗，替代抽屉） ===== */}
      <CustomerDetailModal
        open={detailModalOpen}
        customer={detailCustomer}
        customerList={list}
        onClose={() => setDetailModalOpen(false)}
        onDetailLoaded={handleDetailLoaded}
        onSaved={handleDetailUpdated}
        onTagsChanged={handleTagsChanged}
        onTransfer={handleTransferFromModal}
        onRelease={handleReleaseFromModal}
        onDelete={handleDeleteFromModal}
        onAddPipeline={(c) => openCreatePipeline(c)}
        onCreateOrder={(c) => openCreateOrder(c.id)}
        onToggleKeyAccount={async (c) => {
          // 先本地乐观更新（保留聚合字段，避免金额被清成 undefined），再调用后端持久化
          const nextKey = !c.isKeyAccount;
          const applyLocal = (item: Customer): Customer =>
            item.id === c.id ? mergeKeepAgg(item, { ...item, isKeyAccount: nextKey }) : item;
          setDetailCustomer((prev) => (prev?.id === c.id ? { ...prev, isKeyAccount: nextKey } : prev));
          setList((prev) => sortCustomers(prev.map(applyLocal)));
          try {
            await customerApi.update(c.id, { isKeyAccount: nextKey });
            invalidateDetail(c.id); // 详情缓存失效，下次打开回源最新值
          } catch {
            // 失败回滚
            setDetailCustomer((prev) => (prev?.id === c.id ? { ...prev, isKeyAccount: c.isKeyAccount } : prev));
            setList((prev) => sortCustomers(prev.map((item) => (item.id === c.id ? { ...item, isKeyAccount: c.isKeyAccount } : item))));
            message.error('重点客户状态更新失败');
          }
        }}
      />

      {/* ===== 导入弹窗 ===== */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { setImportOpen(false); invalidateAll(); fetchData(); }}
      />

      {/* ===== 订单弹窗 ===== */}
      <OrderFormModal
        open={orderModalOpen}
        customer={orderCustomer}
        onClose={() => { setOrderModalOpen(false); setOrderCustomer(null); }}
        onSuccess={handleOrderSuccess}
      />
    </div>
  );
}
