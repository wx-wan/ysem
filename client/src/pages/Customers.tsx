import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Button, Select, App, Typography, Spin, theme, Row, Col,
} from 'antd';
import { customerApi, Customer } from '../api/customers';
import { orderApi, Order } from '../api/customers';
import { userApi, User } from '../api/users';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { useAuthStore } from '../stores/useAuthStore';
import CustomerStats from '../components/customer/CustomerStats';
import CustomerToolbar from '../components/customer/CustomerToolbar';
import CustomerCard from '../components/customer/CustomerCard';
import CustomerList from '../components/customer/CustomerList';
import CustomerDetailDrawer from '../components/CustomerDetailDrawer';
import CustomerFormModal from '../components/customer/CustomerFormModal';
import TransferModal from '../components/customer/TransferModal';
import ImportModal from '../components/customer/ImportModal';
import OrderFormModal from '../components/customer/OrderFormModal';

const { Text } = Typography;

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
  const [filterType, setFilterType] = useState<'all' | 'new' | 'old' | 'noOrder' | 'done' | 'key' | 'public'>('all');

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // 详情抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const pageSize = 12;

  // ========== 加载数据 ==========
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, keyword: keyword || undefined };

      if (isAdmin) {
        if (selectedOwnerId && filterType !== 'public') params.ownerId = selectedOwnerId;
        if (filterType !== 'all') params.type = filterType;
        if (filterTags) params.tags = filterTags;
        const res = await customerApi.listAll(params);
        const d = res.data.data;
        setList(d.list);
        setTotal(d.total);
        setEstimatedAmount(d.estimatedAmount || 0);
        setTotalContractAmount(d.totalContractAmount || 0);
        setEstimatedBreakdown(d.estimatedBreakdown || []);
        setContractBreakdown(d.contractBreakdown || []);
      } else {
        if (filterType !== 'all') params.type = filterType;
        if (filterTags) params.tags = filterTags;
        const res = await customerApi.listMy(params);
        const d = res.data.data;
        setList(d.list);
        setTotal(d.total);
        setEstimatedAmount(d.estimatedAmount || 0);
        setTotalContractAmount(d.totalContractAmount || 0);
        setEstimatedBreakdown(d.estimatedBreakdown || []);
        setContractBreakdown(d.contractBreakdown || []);
      }
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, isAdmin, selectedOwnerId, filterType, filterTags]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 加载用户列表（用于筛选和转交）
  useEffect(() => {
    userApi.list({ pageSize: 200 }).then((res) => {
      setUserList(res.data.data?.list || []);
    }).catch(() => {});
  }, []);

  // ========== 打开详情 ==========
  const openDetail = useCallback(async (customer: Customer) => {
    setDetailCustomer(null);
    setCustomerOrders([]);
    setDrawerOpen(true);
    setDetailLoading(true);
    try {
      const [detail, orders] = await Promise.all([
        customerApi.getById(customer.id),
        orderApi.listByCustomer(customer.id),
      ]);
      setDetailCustomer(detail.data.data);
      setCustomerOrders(orders.data.data);
    } catch {
      message.error('加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // ========== 创建/编辑弹窗 ==========
  const openCreate = () => {
    setEditingCustomer(null);
    setModalOpen(true);
  };

  // ========== 转交 ==========
  const openTransfer = useCallback((customerId: string) => {
    const customer = list.find(c => c.id === customerId) || detailCustomer;
    setTransferCustomer(customer);
    setTransferModalOpen(true);
  }, [list, detailCustomer]);

  // ========== 订单弹窗 ==========
  const openCreateOrder = (customerId: string) => {
    const customer = list.find(c => c.id === customerId) || null;
    setOrderCustomer(customer);
    setOrderModalOpen(true);
  };

  const handleOrderSuccess = async () => {
    setOrderModalOpen(false);
    if (detailCustomer) {
      const fresh = await customerApi.getById(detailCustomer.id);
      setDetailCustomer(fresh.data.data);
      const orders = await orderApi.listByCustomer(detailCustomer.id);
      setCustomerOrders(orders.data.data);
    }
    fetchData();
  };

  // ========== 渲染卡片视图 ==========
  const renderCardView = useMemo(() => (
    <Row gutter={[16, 16]}>
      {list.map((customer) => (
        <Col key={customer.id} xs={24} sm={12} md={8} lg={8} xl={8}>
          <CustomerCard
            customer={customer}
            token={token}
            formatCurrency={formatCurrency}
            onOpenDetail={openDetail}
            onListUpdate={setList}
          />
        </Col>
      ))}
    </Row>
  ), [list, token, formatCurrency, openDetail]);

  // ========== 渲染列表视图 ==========
  const renderListView = useMemo(() => (
    <CustomerList
      list={list}
      token={token}
      formatCurrency={formatCurrency}
      onOpenDetail={openDetail}
      onListUpdate={setList}
    />
  ), [list, token, formatCurrency, openDetail]);

  // ========== 分页器 ==========
  const renderPagination = useMemo(() => {
    const totalPages = Math.ceil(total / pageSize);
    if (totalPages <= 1) return null;
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 24, paddingBottom: 8 }}>
        <Button
          size="small"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          上一页
        </Button>
        <Text style={{ fontSize: 13 }}>
          第 {page} / {totalPages} 页，共 {total} 条
        </Text>
        <Button
          size="small"
          disabled={page >= totalPages}
          onClick={() => setPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    );
  }, [total, page, pageSize]);

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* 统计卡片 */}
      {isAdmin && filterType !== 'public' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Select
            placeholder="筛选业务员"
            value={selectedOwnerId || undefined}
            onChange={(v) => { setSelectedOwnerId(v || ''); setPage(1); }}
            allowClear
            style={{ width: 200, borderRadius: 8 }}
            showSearch
            filterOption={(input: string, option: any) =>
              option?.label?.toLowerCase().includes(input.toLowerCase())
            }
            options={userList
              .filter((u: User) => u.status === 'ACTIVE')
              .map((u: User) => ({
                value: u.id,
                label: u.realName || u.username,
              }))}
          />
        </div>
      )}
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
        setImportOpen={setImportOpen}
        openCreate={openCreate}
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
        userList={userList.map(u => ({ id: u.id, realName: u.realName || u.username }))}
        onClose={() => { setTransferModalOpen(false); setTransferCustomer(null); }}
        onSuccess={() => {
          setTransferModalOpen(false);
          setTransferCustomer(null);
          if (drawerOpen) setDrawerOpen(false);
          fetchData();
        }}
      />

      {/* ===== 详情抽屉 ===== */}
      <CustomerDetailDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={detailLoading}
        customer={detailCustomer}
        orders={customerOrders}
        user={user}
        onRefresh={async (customerId) => {
          fetchData();
          // 详情还开着且是同一个客户时，重新拉取最新详情
          if (detailCustomer?.id === customerId) {
            const [detail, orders] = await Promise.all([
              customerApi.getById(customerId),
              orderApi.listByCustomer(customerId),
            ]);
            setDetailCustomer(detail.data.data);
            setCustomerOrders(orders.data.data);
          }
        }}
        onTransfer={openTransfer}
        openCreateOrder={openCreateOrder}
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
