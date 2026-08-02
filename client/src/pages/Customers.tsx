import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  App, Spin, theme, Row, Col, Pagination,
} from 'antd';
import { customerApi, Customer } from '../api/customers';
import { userApi, User } from '../api/users';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { useAuthStore } from '../stores/useAuthStore';
import { getGrade } from '../components/customer/utils';
import CustomerStats from '../components/customer/CustomerStats';
import CustomerToolbar from '../components/customer/CustomerToolbar';
import CustomerCard from '../components/customer/CustomerCard';
import CustomerList from '../components/customer/CustomerList';
import CustomerDetailModal from '../components/customer/CustomerDetailModal';
import CustomerFormModal from '../components/customer/CustomerFormModal';
import TransferModal from '../components/customer/TransferModal';
import ImportModal from '../components/customer/ImportModal';
import OrderFormModal from '../components/customer/OrderFormModal';

export default function CustomersPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { format: formatCurrency } = useCurrencyStore();

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

  // 客户端排序：重点客户优先 → 等级 A→B→C→D → 预计商机金额降序 → 新客优先 → 成交订单金额降序 → 创建时间倒序
  const sortCustomers = useCallback((customers: Customer[]): Customer[] => {
    const gradeOrder: Record<string, number> = { A: 1, B: 2, C: 3, D: 4 };
    const currentYear = new Date().getFullYear().toString();
    return [...customers].sort((a, b) => {
      // 重点客户优先
      if (a.isKeyAccount !== b.isKeyAccount) return a.isKeyAccount ? -1 : 1;
      const ga = gradeOrder[getGrade(a).grade];
      const gb = gradeOrder[getGrade(b).grade];
      if (ga !== gb) return ga - gb;
      // 预计商机金额从高到低
      const amtA = a.pipelineAmount || 0;
      const amtB = b.pipelineAmount || 0;
      if (amtA !== amtB) return amtB - amtA;
      // 新客户在老客户之前（无订单的排在最后）
      const orderRank = (c: Customer) => {
        if (!c.firstOrderDate) return 2;
        return c.firstOrderDate.startsWith(currentYear) ? 0 : 1;
      };
      const ra = orderRank(a);
      const rb = orderRank(b);
      if (ra !== rb) return ra - rb;
      // 成交订单金额从高到低
      const totalA = a.totalAmount || 0;
      const totalB = b.totalAmount || 0;
      if (totalA !== totalB) return totalB - totalA;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
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
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page: 1, pageSize: API_PAGE_SIZE, keyword: keyword || undefined };

      let rawList: Customer[] = [];
      let estAmount = 0;
      let estBreakdown: any[] = [];
      let cntBreakdown: any[] = [];
      let cntTotal = 0;

      if (isAdmin) {
        if (selectedOwnerId && filterType !== 'public') params.ownerId = selectedOwnerId;

        // 组合 filterType + subFilterType 为 API 参数
        let apiType: string = filterType;
        if (filterType === 'noOrder' && subFilterType) apiType = `noOrder-${subFilterType}`;
        else if (filterType === 'done' && subFilterType) apiType = `done-${subFilterType}`;
        if (apiType !== 'all') (params as any).type = apiType;

        if (filterTags) params.tags = filterTags;
        const res = await customerApi.listAll(params);
        const d = res.data.data;
        rawList = d.list;
        estAmount = d.estimatedAmount || 0;
        cntTotal = d.totalContractAmount || 0;
        estBreakdown = d.estimatedBreakdown || [];
        cntBreakdown = d.contractBreakdown || [];
      } else {
        let apiType: string = filterType;
        if (filterType === 'noOrder' && subFilterType) apiType = `noOrder-${subFilterType}`;
        else if (filterType === 'done' && subFilterType) apiType = `done-${subFilterType}`;
        if (apiType !== 'all') (params as any).type = apiType;

        if (filterTags) params.tags = filterTags;
        const res = await customerApi.listMy(params);
        const d = res.data.data;
        rawList = d.list;
        estAmount = d.estimatedAmount || 0;
        cntTotal = d.totalContractAmount || 0;
        estBreakdown = d.estimatedBreakdown || [];
        cntBreakdown = d.contractBreakdown || [];
      }

      const sorted = sortCustomers(rawList);
      setList(sorted);
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
    fetchData();
  }, [fetchData]);

  const openTransfer = useCallback((customerId: string) => {
    const found = list.find((c) => c.id === customerId);
    if (found) {
      setTransferCustomer(found);
      setTransferModalOpen(true);
    }
  }, [list]);

  // ===== 详情弹窗回调占位（业务逻辑后续接入） =====
  const handleEditFromModal = useCallback((c: Customer) => {
    setDetailModalOpen(false);
    setEditingCustomer(c); // 暂存，后续接入编辑弹窗：setModalOpen(true)
    // TODO: 打开客户编辑弹窗
    message.info('编辑客户（待接入）');
  }, [message]);

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
  const openDetail = useCallback(async (customer: Customer) => {
    setDetailCustomer(customer);
    setDetailModalOpen(true);
    try {
      const detail = await customerApi.getById(customer.id);
      if (detail.data?.data) {
        setDetailCustomer(detail.data.data);
      }
    } catch {
      message.error('加载详情失败');
    }
  }, []);

  // ========== 创建/编辑弹窗 ==========
  const openCreate = useCallback(() => {
    setEditingCustomer(null);
    setModalOpen(true);
  }, []);

  const handleOrderSuccess = useCallback(async () => {
    setOrderModalOpen(false);
    if (detailCustomer) {
      const fresh = await customerApi.getById(detailCustomer.id);
      setDetailCustomer(fresh.data.data);
    }
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
      <CustomerStats total={total} estimatedAmount={estimatedAmount} totalContractAmount={totalContractAmount} list={list} token={token} filterType={filterType} formatCurrency={formatCurrency} estimatedBreakdown={estimatedBreakdown} contractBreakdown={contractBreakdown} />

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
        onSuccess={fetchData}
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
          fetchData();
        }}
      />

      {/* ===== 详情弹窗（居中大弹窗，替代抽屉） ===== */}
      <CustomerDetailModal
        open={detailModalOpen}
        customer={detailCustomer}
        onClose={() => setDetailModalOpen(false)}
        onEdit={handleEditFromModal}
        onTransfer={handleTransferFromModal}
        onRelease={handleReleaseFromModal}
        onDelete={handleDeleteFromModal}
        onAddPipeline={(c) => openCreatePipeline(c)}
        onCreateOrder={(c) => openCreateOrder(c.id)}
        onToggleKeyAccount={(c) => {
          // 仅局部同步 UI 状态：弹窗 + 列表中对应项，避免整页 fetchData 造成的卡顿/闪烁
          const next = { ...c, isKeyAccount: !c.isKeyAccount };
          setDetailCustomer((prev) => (prev?.id === c.id ? next : prev));
          handleListUpdate((prev) =>
            prev.map((item) => (item.id === c.id ? { ...item, isKeyAccount: !c.isKeyAccount } : item))
          );
        }}
      />

      {/* ===== 导入弹窗 ===== */}
      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { setImportOpen(false); fetchData(); }}
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
