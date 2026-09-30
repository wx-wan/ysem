import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  App, Spin, theme, Row, Col, Pagination, Modal, Radio, Empty, Card,
} from 'antd';
import { customerApi, Customer, type OpportunitySummary } from '../api/customers';
import { userApi, User, UserSelectItem } from '../api/users';
import { useAuthStore } from '../stores/useAuthStore';
import { compareCustomers } from '../components/customer/shared/utils';
import CustomerStats from '../components/customer/cards/CustomerStats';
import CustomerToolbar from '../components/customer/list/CustomerToolbar';
import CustomerCard from '../components/customer/cards/CustomerCard';
import CustomerDetailModal from '../components/customer/modals/CustomerDetailModal';
import TransferOwnerModal from '../components/common/TransferOwnerModal';

import { buildTablePagination } from '../components/common/tablePagination';
import { useReleaseToPool } from '../hooks/useReleaseToPool';
import { debounce } from '../utils/rateLimit';

export default function CustomersPage() {
  const { token } = theme.useToken();
  const { message, modal } = App.useApp();
  const releaseToPool = useReleaseToPool();

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
  // 标签筛选：已提交的标签关键词（对客户标签做模糊匹配）+ 输入框本地态
  const [tagKeyword, setTagKeyword] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [sort, setSort] = useState<'smart' | 'createdAt:desc' | 'createdAt:asc'>('smart');
  // 数据范围（切换栏）：我的 / 团队（管理员）/ 公海；角色就绪后确定默认值
  const [scopeTab, setScopeTab] = useState<'mine' | 'team' | 'public' | null>(null);
  // 筛选条件（展开面板）：成交状态 + 采购意向/客户类型子筛选 + 重点客户
  const [dealStatus, setDealStatus] = useState<'' | 'noOrder' | 'done'>('');
  const [intentSub, setIntentSub] = useState<string>(''); // 未成交: 'A'|'B'|'C'|'D'|'none'，已成交: 'new'|'old'
  const [keyOnly, setKeyOnly] = useState(false);

  // 详情弹窗（居中大弹窗，替代抽屉）
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);

  // 转交
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferCustomer, setTransferCustomer] = useState<Customer | null>(null);
  const [userList, setUserList] = useState<UserSelectItem[]>([]);

  // 详情版本号：商机变更后递增，触发 CustomerDetailModal 重新拉取数据
  const [detailVersion, setDetailVersion] = useState(0);

  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role?.code === 'admin';

  // 当前详情客户是否可操作（归属人本人 或 管理员）
  // 注：该判定由 CustomerDetailModal 内部承担（原 CustomerDetailDrawer 已于 Round 3C-2-1 删除）

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

  // 成交状态 + 子筛选 → 接口 type（'' = 不限）
  const dealType = dealStatus ? (intentSub ? `${dealStatus}-${intentSub}` : dealStatus) : '';

  // 是否存在搜索 / 筛选条件（仅用于空态文案区分；数据范围切换不算筛选）
  const hasActiveFilter = !!(keyword || tagKeyword || selectedOwnerId || dealType || keyOnly);

  // 排序方式：smart = 默认智能排序（compareCustomers）；其余为按创建时间升 / 降序
  const sortList = useCallback((customers: Customer[]): Customer[] => {
    if (sort === 'createdAt:desc') {
      return [...customers].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    if (sort === 'createdAt:asc') {
      return [...customers].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return customers; // 智能排序：list 本身已按 compareCustomers 有序
  }, [sort]);

  // 当前页展示列表（先按所选排序方式排列，再取当前页）
  const displayList = useMemo(() => {
    return sortList(list).slice((page - 1) * pageSize, page * pageSize);
  }, [list, page, sortList]);

  // ========== 加载数据 ==========
  // 防止 StrictMode 双重挂载 / useEffect 双次触发导致重复请求
  const fetchingRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return;
    if (!scopeTab) return; // 角色未就绪（默认范围未确定）前不请求，避免以错误范围取数
    fetchingRef.current = true;

    const params: any = { page: 1, pageSize: API_PAGE_SIZE, keyword: keyword || undefined };

    // 范围（正交参数）：公海 = 仅无负责人客户；与成交状态 / 重点客户可组合
    if (scopeTab === 'public') params.publicSea = '1';
    // 成交状态 + 子筛选 → type
    if (dealType) params.type = dealType;
    if (keyOnly) params.keyAccount = '1';
    // 归属人：管理员「我的」锁定本人；「团队」可按业务员筛选
    if (isAdmin && scopeTab === 'mine') params.ownerId = user?.id;
    else if (isAdmin && scopeTab === 'team' && selectedOwnerId) params.ownerId = selectedOwnerId;
    if (tagKeyword) params.tags = tagKeyword;

    setLoading(true);
    try {
      const res = isAdmin
        ? await customerApi.listAll(params)
        : await customerApi.listMy(params);
      const d = res.data.data;

      const sorted = sortCustomers(d.list);
      setList(sorted);
      setTotal(sorted.length);
      setEstimatedAmount(d.estimatedAmount || 0);
      setTotalContractAmount(d.totalContractAmount || 0);
      setEstimatedBreakdown(d.estimatedBreakdown || []);
      setContractBreakdown(d.contractBreakdown || []);
      setNoOrderBreakdown(d.noOrderBreakdown || {});
      setDoneBreakdown(d.doneBreakdown || {});
      setPage(1);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
      fetchingRef.current = false;
    }
  }, [keyword, isAdmin, selectedOwnerId, scopeTab, dealType, keyOnly, tagKeyword, sortCustomers, user?.id]);

  // 角色就绪后确定默认数据范围：管理员默认「团队」，其余默认「我的」
  useEffect(() => {
    if (!user || scopeTab !== null) return;
    setScopeTab(isAdmin ? 'team' : 'mine');
  }, [user, isAdmin, scopeTab]);

  // 范围切换：切换后清掉只对原范围有意义的业务员筛选，并回到第 1 页
  const handleScopeChange = useCallback((next: 'mine' | 'team' | 'public') => {
    setScopeTab(next);
    setSelectedOwnerId('');
    setPage(1);
  }, []);

  useEffect(() => {
    // 先确定角色再发起列表请求：user 未加载（role 未知）时暂不请求，
    // 避免以错误的角色（非管理员）发起 listMy，拿到不完整数据
    if (!user || !scopeTab) return;
    fetchData();
  }, [fetchData, user, scopeTab]);

  const openTransfer = useCallback((customerId: string) => {
    const found = list.find((c) => c.id === customerId);
    if (found) {
      setTransferCustomer(found);
      setTransferModalOpen(true);
    }
  }, [list]);

  // 列表项上的聚合字段（商机金额/成交金额/最后下单日期）由 list 接口计算，
  // getById（详情接口）不返回它们；合并详情数据时必须保留，否则会被清成 undefined。
  const AGG_FIELDS = ['pipelineAmount', 'totalAmount', 'lastOrderDate'] as const;

  // 用 next 覆盖 prev 的变化字段，但保留 prev 上 list 接口的聚合字段（next 没有时不清空）
  const mergeKeepAgg = useCallback((prev: Customer | null, next: Customer): Customer => {
    if (!prev || prev.id !== next.id) return next;
    const merged = { ...prev, ...next };
    for (const f of AGG_FIELDS) {
      if (next[f] === undefined) (merged as any)[f] = (prev as any)[f];
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
  }, [mergeKeepAgg]);

  // ===== 标签变更：最小化同步，只改 tags 字段，不重建整个对象（避免关联信息丢失） =====
  const handleTagsChanged = useCallback((id: string, tags: string[]) => {
    setDetailCustomer((prev) => (prev && prev.id === id ? { ...prev, tags } : prev));
    setList((prev) =>
      sortCustomers(prev.map((item) => (item.id === id ? { ...item, tags } : item)))
    );
  }, [sortCustomers]);

  // 转交：保持客户详情弹窗打开，仅在其上叠加转交弹窗（转交弹窗层级 overlay 2000 > 详情 1001）
  const handleTransferFromModal = useCallback((c: Customer) => {
    openTransfer(c.id);
  }, [openTransfer]);

  // 释放客户到公海：二次确认 → 调用释放接口 → 刷新列表
  const handleReleaseFromModal = useCallback((c: Customer) => {
    // 文案 / 确认弹窗样式与线索释放完全一致，均由 useReleaseToPool 统一提供
    releaseToPool({
      name: c.companyName || c.contactName || '',
      // 公海客户（无归属人）无需释放，后端也会返回 400
      alreadyInPool: !c.ownerId,
      action: () => customerApi.release(c.id),
      onSuccess: () => {
        setDetailModalOpen(false);
        fetchData();
      },
    });
  }, [releaseToPool, fetchData]);

  const handleDeleteFromModal = useCallback(async (c: Customer) => {
    setDetailModalOpen(false);
    try {
      await customerApi.remove(c.id);
      message.success(`已删除客户 ${c.companyName || c.contactName || ''}`);
      fetchData();
    } catch {
      message.error('删除客户失败');
    }
  }, [message, fetchData]);

  // 加载用户列表（用于筛选和转交）
  const usersFetched = useRef(false);
  useEffect(() => {
    if (usersFetched.current) return;
    usersFetched.current = true;
    userApi.listForSelect().then((res) => {
      setUserList(res.data.data || []);
    }).catch(() => {});
  }, []);

  // ========== 关键词搜索 ==========
  // 与线索页一致：本地输入态即时回显，防抖后才提交到 keyword（避免逐字触发全量列表请求）
  const [kw, setKw] = useState('');
  const commitKeyword = useMemo(
    () => debounce((v: string) => { setKeyword(v); setPage(1); }, 400),
    [],
  );
  const handleSearchChange = useCallback((v: string) => {
    setKw(v);
    commitKeyword(v);
  }, [commitKeyword]);

  // ========== 标签筛选（模糊匹配） ==========
  // 同为「本地输入态 + 防抖提交」，避免逐字触发列表请求
  const commitTagKeyword = useMemo(
    () => debounce((v: string) => { setTagKeyword(v); setPage(1); }, 400),
    [],
  );
  const handleTagChange = useCallback((v: string) => {
    setTagInput(v);
    commitTagKeyword(v);
  }, [commitTagKeyword]);

  // 清除全部筛选条件（数据范围切换保留）
  const handleClearFilters = useCallback(() => {
    setDealStatus('');
    setIntentSub('');
    setKeyOnly(false);
    setSelectedOwnerId('');
    setTagInput('');
    setTagKeyword('');
    setPage(1);
  }, []);

  // ========== 打开详情 ==========
  // 同步打开：仅设置本地数据与显示弹窗，完整详情（owner/opportunities）由 Modal 内部
  // 通过 getById 异步补充。这样点击卡片时父组件零 async 阻塞，弹窗即时出现。
  const openDetail = useCallback((customer: Customer) => {
    setDetailCustomer(customer);
    setDetailModalOpen(true);
  }, []);

  // ========== 渲染卡片视图（与线索页一致：仅卡片列表，不再提供列表/卡片切换） ==========
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
      {/* 统计模块 + 筛选栏 + 客户卡片：同一张白色底卡片包裹（层级与线索页一致） */}
      <Card
        variant="borderless"
        style={{
          borderRadius: token.borderRadiusLG,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <CustomerStats total={total} estimatedAmount={estimatedAmount} totalContractAmount={totalContractAmount} list={list} token={token} filterType={dealType || 'all'} estimatedBreakdown={estimatedBreakdown} contractBreakdown={contractBreakdown} />

        {/* 工具栏（筛选栏交互与线索页一致；第二行仅保留数据范围，分类移入筛选面板） */}
        <CustomerToolbar
          searchValue={kw}
          onSearchChange={handleSearchChange}
          onSearchSubmit={() => { setKeyword(kw); setPage(1); }}
          setPage={setPage}
          total={total}
          tagValue={tagInput}
          onTagChange={handleTagChange}
          onTagSubmit={() => { setTagKeyword(tagInput.trim()); setPage(1); }}
          onClearFilters={handleClearFilters}
          scopeTab={scopeTab ?? 'mine'}
          onScopeChange={handleScopeChange}
          dealStatus={dealStatus}
          onDealStatusChange={(v) => {
            setDealStatus(v as typeof dealStatus);
            setIntentSub(''); // 成交状态变化后，子筛选（采购意向 / 客户类型）不再适用
            setPage(1);
          }}
          intentSub={intentSub}
          onIntentSubChange={(v) => { setIntentSub(v); setPage(1); }}
          keyOnly={keyOnly}
          onKeyOnlyChange={(v) => { setKeyOnly(v); setPage(1); }}
          isAdmin={isAdmin}
          selectedOwnerId={selectedOwnerId}
          setSelectedOwnerId={setSelectedOwnerId}
          userList={userList}
          noOrderBreakdown={noOrderBreakdown}
          doneBreakdown={doneBreakdown}
          sortValue={sort}
          onSortChange={(v) => { setSort(v as typeof sort); setPage(1); }}
        />

        {/* 内容区 */}
        <div style={{ marginTop: 16 }}>
          <Spin spinning={loading}>
            {list.length === 0 && !loading ? (
              <div style={{ textAlign: 'center', padding: '48px 0' }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ fontSize: 13, color: token.colorTextTertiary }}>
                      {hasActiveFilter ? '没有找到符合条件的客户，试试调整筛选条件' : '暂无客户数据'}
                    </span>
                  }
                />
              </div>
            ) : (
              renderCardView
            )}
          </Spin>
        </div>
      </Card>

      {/* 分页（超出单页记录时出现；位于白卡之外，与线索页一致） */}
      {renderPagination}

      {/* ===== 转交弹窗（与线索共用同一组件 / 逻辑） ===== */}
      <TransferOwnerModal
        open={transferModalOpen}
        targetName={transferCustomer?.companyName}
        currentOwnerId={transferCustomer?.ownerId}
        userList={transferUserList}
        onTransfer={async (userId) => {
          await customerApi.transfer(transferCustomer!.id, userId);
        }}
        onClose={() => { setTransferModalOpen(false); setTransferCustomer(null); }}
        onSuccess={() => {
          setTransferModalOpen(false);
          setTransferCustomer(null);
          // 详情弹窗保持打开：递增版本号触发详情重新拉取，即时展示新负责人
          setDetailVersion((v) => v + 1);
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
          } catch {
            // 失败回滚
            setDetailCustomer((prev) => (prev?.id === c.id ? { ...prev, isKeyAccount: c.isKeyAccount } : prev));
            setList((prev) => sortCustomers(prev.map((item) => (item.id === c.id ? { ...item, isKeyAccount: c.isKeyAccount } : item))));
            message.error('重点客户状态更新失败');
          }
        }}
      />

    </div>
  );
}
