import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  App, Spin, theme, Row, Col, Pagination, Modal, Radio,
} from 'antd';
import { customerApi, Customer } from '../api/customers';
import { userApi, User } from '../api/users';
import { salesApi, SalesItem } from '../api/sales';
import { useAuthStore } from '../stores/useAuthStore';
import { compareCustomers } from '../components/customer/shared/utils';
import { diffList } from '../utils/diff';
import {
  listCacheKey, getListCache, setListCache, invalidateAll, invalidateDetail, setDetailCache, installCacheLifecycle,
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
import SalesFormModal from '../components/sales/SalesFormModal';
import { buildTablePagination } from '../components/common/tablePagination';

export default function CustomersPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();

  // ========== 状态 ==========
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [estimatedAmount, setEstimatedAmount] = useState(0);
  const [estimatedBreakdown, setEstimatedBreakdown] = useState<any[]>([]);
  const [contractBreakdown, setContractBreakdown] = useState<any[]>([]);
  const [totalContractAmount, setTotalContractAmount] = useState(0);
  const [noOrderBreakdown, setNoOrderBreakdown] = useState<Record<string, number>>({});
  const [doneBreakdown, setDoneBreakdown] = useState<Record<string, number>>({});
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

  // 商机编辑弹窗
  const [pipelineEditOpen, setPipelineEditOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<SalesItem | null>(null);
  const [newPipelineStage, setNewPipelineStage] = useState<string>('LEAD');
  // 从详情新建时携带的客户（公司名称固定、基础信息带出、负责人锁当前用户）
  const [newPipelineCustomer, setNewPipelineCustomer] = useState<Customer | null>(null);

  // 新建销售记录：类型选择弹窗（线索 / 商机 / 订单）
  const [newTypeOpen, setNewTypeOpen] = useState(false);
  const [newTypeCustomer, setNewTypeCustomer] = useState<Customer | null>(null);

  // 转化订单弹窗
  const [convertModalOpen, setConvertModalOpen] = useState(false);
  const [convertPipeline, setConvertPipeline] = useState<SalesItem | null>(null);

  // 详情版本号：商机变更后递增，触发 CustomerDetailModal 重新拉取数据
  const [detailVersion, setDetailVersion] = useState(0);

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

  // 防止 StrictMode 双重挂载 / useEffect 双次触发导致重复请求
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

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
      fetchingRef.current = false;
      const { mergedList } = diffList(currentList, cached.list);
      setList(sortCustomers(mergedList));
      setTotal(cached.total);
      setEstimatedAmount(cached.estimatedAmount);
      setTotalContractAmount(cached.totalContractAmount);
      setEstimatedBreakdown(cached.estimatedBreakdown);
      setContractBreakdown(cached.contractBreakdown);
      setNoOrderBreakdown(cached.noOrderBreakdown || {});
      setDoneBreakdown(cached.doneBreakdown || {});
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
      const noOrderBd = d.noOrderBreakdown || {};
      const doneBd = d.doneBreakdown || {};

      const sorted = sortCustomers(rawList);
      setListCache(cacheKey, {
        list: sorted,
        total: sorted.length,
        estimatedAmount: estAmount,
        totalContractAmount: cntTotal,
        estimatedBreakdown: estBreakdown,
        contractBreakdown: cntBreakdown,
        noOrderBreakdown: noOrderBd,
        doneBreakdown: doneBd,
      });
      const { mergedList } = diffList(currentList, sorted);
      setList(sortCustomers(mergedList));
      setTotal(sorted.length);
      setEstimatedAmount(estAmount);
      setTotalContractAmount(cntTotal);
      setEstimatedBreakdown(estBreakdown);
      setContractBreakdown(cntBreakdown);
      setNoOrderBreakdown(noOrderBd);
      setDoneBreakdown(doneBd);
      setPage(1);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [keyword, isAdmin, selectedOwnerId, filterType, subFilterType, filterTags, sortCustomers]);

  useEffect(() => {
    installCacheLifecycle(); // 注册「离开视图即失效」缓存生命周期（幂等）
    // 先确定角色再发起列表请求：user 未加载（role 未知）时暂不请求，
    // 避免以错误的角色（非管理员）发起 listMy，拿到不完整数据
    if (!user) return;
    fetchData();
  }, [fetchData, user]);

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
    invalidateDetail(updated.id); // 该客户详情缓存已过期，下次打开回源；列表缓存保留
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

  const handleDeleteFromModal = useCallback(async (c: Customer) => {
    setDetailModalOpen(false);
    try {
      await customerApi.remove(c.id);
      message.success(`已删除客户 ${c.companyName || c.contactName || ''}`);
      invalidateAll();
      fetchData();
    } catch {
      message.error('删除客户失败');
    }
  }, [message, fetchData]);

  // 打开「新建销售记录」类型选择弹窗
  const openPickNewType = useCallback((c: Customer) => {
    setNewTypeCustomer(c);
    setNewTypeOpen(true);
  }, []);

  // 按类型打开对应新建表单（线索/商机走 SalesFormModal，订单走 OrderFormModal）
  // 注意：保留客户详情弹窗不关闭，新建表单叠在其上
  const openCreatePipeline = useCallback((c: Customer, stage: 'LEAD' | 'OPPORTUNITY' = 'LEAD') => {
    setNewTypeOpen(false);
    setNewTypeCustomer(null);
    setEditingPipeline(null);
    setNewPipelineStage(stage);
    setNewPipelineCustomer(c); // 携带客户：公司名称固定、基础信息带出、负责人锁当前用户
    setPipelineEditOpen(true);
  }, []);

  // 编辑商机：数据来自父级（详情里的 pipelines 已是完整 SalesItem），无需再请求
  const handleEditPipeline = useCallback((pipeline: any) => {
    setEditingPipeline(pipeline as SalesItem);
    setPipelineEditOpen(true);
  }, []);

  // 商机编辑保存成功：先更新前端缓存保证界面一致，最后再持久化到数据库
  const handlePipelineEditSuccess = useCallback(async (values: any) => {
    const cid = detailCustomer?.id;
    // 1) 先更新前端缓存（乐观更新详情中的商机数据），保证前端数据一致
    if (cid && detailCustomer && editingPipeline) {
      setDetailCustomer((prev) => {
        if (!prev) return prev;
        const pipelines = prev.pipelines ? [...prev.pipelines] : [];
        const idx = pipelines.findIndex((p: any) => p.id === editingPipeline.id);
        const updated = { ...editingPipeline, ...values, stage: values.stage || editingPipeline.stage };
        if (idx >= 0) pipelines[idx] = updated;
        else pipelines.push(updated);
        return { ...prev, pipelines };
      });
    }
    // 2) 最后更新到数据库
    try {
      if (editingPipeline) {
        await salesApi.update(editingPipeline.id, values);
        message.success('更新成功');
      } else {
        await salesApi.create(values);
        message.success('创建成功');
      }
    } catch (e) {
      message.error('保存失败，请重试');
    }
    setPipelineEditOpen(false);
    setEditingPipeline(null);
    setDetailVersion(v => v + 1);
    // 3) 仅更新前端详情缓存，不再发网络回源（概览聚合金额来自详情缓存，已由上方乐观更新保持一致）
    if (cid) {
      setDetailCustomer((prev2) => {
        if (prev2) setDetailCache(prev2);
        return prev2;
      });
    }
    invalidateDetail(cid || '');
  }, [detailCustomer, editingPipeline, message]);

  // 商机转订单
  const handleConvertPipeline = useCallback((pipeline: RealPipeline) => {
    setConvertPipeline(pipeline);
    setConvertModalOpen(true);
  }, []);

  const handleConvertConfirm = useCallback(async () => {
    if (!convertPipeline) return;
    try {
      await salesApi.update(convertPipeline.id, {
        orderStatus: '成交',
        orderAmount: convertPipeline.estimatedAmount,
        orderDate: convertPipeline.estimatedCloseDate || undefined,
      } as any);
      message.success('商机已转为成交订单');
      setConvertModalOpen(false);
      setConvertPipeline(null);
      // 刷新客户详情（数据层来自缓存，不拉列表）
      setDetailVersion(v => v + 1);
      if (detailCustomer) {
        setDetailCustomer((prev) => {
          if (!prev) return prev;
          const pipelines = (prev.pipelines || []).map((p: any) =>
            p.id === convertPipeline.id
              ? { ...p, orderStatus: '成交', orderAmount: convertPipeline.estimatedAmount, orderDate: convertPipeline.estimatedCloseDate || undefined }
              : p
          );
          const updated = { ...prev, pipelines };
          setDetailCache(updated);
          return updated;
        });
      }
      invalidateDetail(detailCustomer?.id || '');
    } catch {
      message.error('转化失败');
    }
  }, [convertPipeline, message, detailCustomer]);

  // 删除商机
  const handleDeletePipeline = useCallback((pipeline: RealPipeline) => {
    modal.confirm({
      title: '删除商机',
      content: `确认删除商机「${pipeline.title || pipeline.companyName}」？此操作不可撤销。`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await salesApi.delete(pipeline.id);
          message.success('商机已删除');
          // 刷新客户详情（数据层来自缓存，不拉列表）
          setDetailVersion(v => v + 1);
          if (detailCustomer) {
            setDetailCustomer((prev) => {
              if (!prev) return prev;
              const pipelines = (prev.pipelines || []).filter((p: any) => p.id !== pipeline.id);
              const updated = { ...prev, pipelines };
              setDetailCache(updated);
              return updated;
            });
          }
          invalidateDetail(detailCustomer?.id || '');
        } catch {
          message.error('删除失败');
        }
      },
    });
  }, [message, detailCustomer]);

  const openCreateOrder = useCallback((customerId: string) => {
    const found = list.find((c) => c.id === customerId);
    if (found) {
      setOrderCustomer(found);
      setOrderModalOpen(true);
    }
  }, [list]);

  // 加载用户列表（用于筛选和转交）
  const usersFetched = useRef(false);
  useEffect(() => {
    if (usersFetched.current) return;
    usersFetched.current = true;
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
    // 订单数据已通过 orderApi 持久化；保持前端详情缓存，不额外回源
    // （订单成功属详情内变更，切走标签页时缓存失效，下次进入自然刷新）
    if (detailCustomer) setDetailCache(detailCustomer);
  }, [detailCustomer]);

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
          {...buildTablePagination({
            total: list.length, page, pageSize,
            onChange: (p) => setPage(p),
          })}
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
        noOrderBreakdown={noOrderBreakdown}
        doneBreakdown={doneBreakdown}
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
        onClose={() => { setDetailModalOpen(false); }}
        onDetailLoaded={handleDetailLoaded}
        onSaved={handleDetailUpdated}
        onTagsChanged={handleTagsChanged}
        onTransfer={handleTransferFromModal}
        onRelease={handleReleaseFromModal}
        onDelete={handleDeleteFromModal}
        onPickNewType={(c) => openPickNewType(c)}
        onCreateOrder={(c) => openCreateOrder(c.id)}
        onEditPipeline={handleEditPipeline}
        onConvertPipeline={handleConvertPipeline}
        onDeletePipeline={handleDeletePipeline}
        detailVersion={detailVersion}
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

      {/* ===== 商机编辑 / 新建弹窗 ===== */}
      <SalesFormModal
        open={pipelineEditOpen}
        editingItem={editingPipeline}
        initialStage={newPipelineStage}
        customer={newPipelineCustomer}
        currentUserId={user?.id}
        fixedOwner={!!newPipelineCustomer}
        assignUsers={userList.map(u => ({ id: u.id, realName: u.realName || u.username }))}
            onClose={() => { setPipelineEditOpen(false); setEditingPipeline(null); setNewPipelineCustomer(null); }}
            onSuccess={handlePipelineEditSuccess}
          />

      {/* 商机转化订单 — 选择订单类型 */}
      <Modal
        title="转为订单"
        open={convertModalOpen}
        onOk={handleConvertConfirm}
        onCancel={() => { setConvertModalOpen(false); setConvertPipeline(null); }}
        okText="确认转化"
        cancelText="取消"
        destroyOnHidden
      >
        <div style={{ marginBottom: 12 }}>
          将商机「<strong>{convertPipeline?.title || convertPipeline?.companyName}</strong>」转为成交订单，预计成交金额 ¥{convertPipeline?.estimatedAmount?.toLocaleString() || 0} 将作为订单金额。
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>订单阶段：</span>
          <span style={{ color: '#16a34a', fontWeight: 600 }}>订单（已成交，进入订单流程）</span>
        </div>
      </Modal>

      {/* 新建销售记录 — 选择类型（线索 / 商机 / 订单） */}
      <Modal
        title="新建销售记录"
        open={newTypeOpen}
        footer={null}
        onCancel={() => { setNewTypeOpen(false); setNewTypeCustomer(null); }}
        width={520}
        destroyOnHidden
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, padding: '8px 0 4px' }}>
          {[
            { key: 'LEAD', label: '线索', desc: '手动新建，或后续由产品链接点击同步', color: '#1677ff' },
            { key: 'OPPORTUNITY', label: '商机', desc: '有明确采购意向与预计成交', color: '#d97706' },
            { key: 'ORDER', label: '订单', desc: '已成交，进入订单 7 阶段流程', color: '#16a34a' },
          ].map((opt) => (
            <div
              key={opt.key}
              onClick={() => {
                if (!newTypeCustomer) return;
                if (opt.key === 'ORDER') {
                  setNewTypeOpen(false);
                  setNewTypeCustomer(null);
                  openCreateOrder(newTypeCustomer.id);
                } else {
                  openCreatePipeline(newTypeCustomer, opt.key as 'LEAD' | 'OPPORTUNITY');
                }
              }}
              style={{
                cursor: 'pointer', padding: '18px 16px', borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer,
                transition: 'all .2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = opt.color;
                e.currentTarget.style.boxShadow = `0 4px 16px ${opt.color}22`;
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = token.colorBorderSecondary;
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: opt.color }} />
                <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText }}>{opt.label}</span>
              </div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.5 }}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
