import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Button, Space, Card,
  Row, Col, App,
  Typography, Avatar, Spin, theme, Table, Tag,
} from 'antd';
import {
  GlobalOutlined,
} from '@ant-design/icons';
import { customerApi, Customer } from '../api/customers';
import { orderApi, Order } from '../api/customers';
import { userApi, User } from '../api/users';
import dayjs from 'dayjs';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { useAuthStore } from '../stores/useAuthStore';
import KeyAccountStar from '../components/KeyAccountStar';
import FlagIcon from '../components/FlagIcon';
import CustomerStats from '../components/customer/CustomerStats';
import CustomerToolbar from '../components/customer/CustomerToolbar';
import CustomerDetailDrawer from '../components/CustomerDetailDrawer';
import CustomerFormModal from '../components/customer/CustomerFormModal';
import TransferModal from '../components/customer/TransferModal';
import ImportModal from '../components/customer/ImportModal';
import OrderFormModal from '../components/customer/OrderFormModal';
import CountryDisplay from '../components/CountryDisplay';
import { getGrade, tagColorToHex, tagColorToBg, getCustomerTypeLabel, avatarColor } from '../components/customer/utils';

const { Text } = Typography;

import { findCountry } from '../data/countries';

// 解析单个标签字符串：支持 "name#color" 和 "name" 两种格式
function parseTag(tagStr: string): { name: string; color?: string } {
  const idx = tagStr.lastIndexOf('#');
  if (idx > 0) {
    return { name: tagStr.slice(0, idx), color: tagStr.slice(idx + 1) };
  }
  return { name: tagStr };
}

// 将 tags 字符串解析为标签数组
function tagsToArray(tags?: string): { name: string; color?: string }[] {
  if (!tags) return [];
  return tags.split(',').filter(Boolean).map(parseTag);
}

export default function CustomersPage() {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { format: formatCurrency } = useCurrencyStore();

  // ========== 状态 ==========
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [filterTags, setFilterTags] = useState('');

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
        if (selectedOwnerId) params.ownerId = selectedOwnerId;
        const res = await customerApi.listAll(params);
        const d = res.data.data;
        setList(d.list);
        setTotal(d.total);
      } else {
        const res = await customerApi.listMy(params);
        const d = res.data.data;
        setList(d.list);
        setTotal(d.total);
      }
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, isAdmin, selectedOwnerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 加载用户列表（用于筛选和转交）
  useEffect(() => {
    userApi.list({ pageSize: 200 }).then((res) => {
      setUserList(res.data.list || []);
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
      {list.map((customer) => {
        const grade = getGrade(customer);
        const ownerName = customer.owner?.realName || customer.owner?.username || '';
        const firstChar = ownerName?.charAt(0) || customer.contactName?.charAt(0) || customer.companyName?.charAt(0) || '?';
        // 卡片头部使用深色主色（tagColorToHex 返回 token.colorError / colorWarning / colorSuccess / colorPrimary 等）
        const headerColor = tagColorToHex(grade.tagColor, token);
        // 头像背景与卡片头部主题色保持一致
        const bgColor = headerColor;

        return (
          <Col xs={24} sm={12} md={8} lg={8} xl={8} key={customer.id}>
            <Card
              hoverable
              onClick={() => openDetail(customer)}
              style={{
                borderRadius: token.borderRadiusLG,
                boxShadow: token.boxShadowSecondary,
                cursor: 'pointer',
                height: '100%',
                overflow: 'hidden',
              }}
              styles={{ body: { padding: 0 } }}
            >
              {/* 彩色头部区域 - 使用深色主色 */}
              <div
                style={{
                  background: `linear-gradient(135deg, ${headerColor} 0%, ${headerColor}dd 100%)`,
                  padding: '20px 20px 18px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* 装饰性圆环 */}
                <div style={{
                  position: 'absolute',
                  top: -36,
                  right: -24,
                  width: 120,
                  height: 120,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.08)',
                }} />
                <div style={{
                  position: 'absolute',
                  bottom: -48,
                  right: 60,
                  width: 88,
                  height: 88,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                  <span style={{
                    backgroundColor: 'rgba(255,255,255,0.2)',
                    backdropFilter: 'blur(4px)',
                    color: token.colorWhite,
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '3px 10px',
                    borderRadius: token.borderRadiusSM,
                    lineHeight: '18px',
                    letterSpacing: '0.3px',
                  }}>
                    {(() => {
                      const currentYear = new Date().getFullYear().toString();
                      if (!customer.firstOrderDate) return '未成交客户';
                      if (customer.firstOrderDate.startsWith(currentYear)) return '本年度新客';
                      return '往年老客';
                    })()} · {grade.grade}级
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KeyAccountStar
                      isKeyAccount={customer.isKeyAccount || false}
                      customerId={customer.id}
                      color="rgba(255,255,255,0.9)"
                      mutedColor="rgba(255,255,255,0.35)"
                      onToggle={() => {
                        setList((prev) =>
                          prev.map((c) =>
                            c.id === customer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                          )
                        );
                      }}
                    />
                    <FlagIcon country={customer.country} style={{ borderRadius: 2 }} />
                  </div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: token.colorWhite, marginTop: 14, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
                  {customer.companyName || '-'}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 6, position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <GlobalOutlined style={{ fontSize: 11 }} />
                  {findCountry(customer.country)?.zh || (customer.country || '未知')}
                </div>
              </div>

              {/* 内容区 */}
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar size={40} style={{ backgroundColor: bgColor, fontSize: 15, fontWeight: 700 }}>
                      {firstChar}
                    </Avatar>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: token.colorTextHeading }}>{customer.contactName || '-'}</div>
                      <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{customer.email || customer.phone || '-'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: token.colorTextSecondary }}>合同额</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: token.colorTextHeading }}>
                      {formatCurrency(customer.totalAmount || 0)}
                    </div>
                    <div style={{ fontSize: 11, color: token.colorTextSecondary }}>{customer._count?.orders ?? 0} 单</div>
                  </div>
                </div>
              </div>

              {/* 底部分隔线 + 标签 */}
              <div style={{ borderTop: `1px dashed ${token.colorBorderSecondary}`, padding: '10px 20px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0, alignItems: 'center' }}>
                  {(() => {
                    const typeLabel = getCustomerTypeLabel(customer);
                    if (typeLabel) {
                      const tc = tagColorToHex(typeLabel.color, token);
                      return (
                        <Tag key="type" bordered={false} style={{
                          margin: 0,
                          borderRadius: token.borderRadiusSM,
                          fontSize: 11,
                          padding: '1px 8px',
                          backgroundColor: token.colorBgContainer,
                          color: tc,
                          border: `1px solid ${tc}`,
                        }}>{typeLabel.label}</Tag>
                      );
                    }
                    return null;
                  })()}
                  {tagsToArray(customer.tags).map((tag) => {
                    const c = tagColorToHex(tag.color, token);
                    return (
                      <Tag key={tag.name} bordered={false} style={{
                        margin: 0,
                        borderRadius: token.borderRadiusSM,
                        fontSize: 11,
                        padding: '1px 8px',
                        backgroundColor: token.colorBgContainer,
                        color: c,
                        border: `1px solid ${c}`,
                      }}>{tag.name}</Tag>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextQuaternary, whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {dayjs(customer.createdAt).format('YYYY-MM-DD')}
                </div>
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  ), [list, token, formatCurrency, openDetail]);

  // ========== 渲染列表视图 ==========
  const renderListView = useMemo(() => {
    const columns = [
      {
        title: '客户',
        dataIndex: 'companyName',
        key: 'companyName',
        render: (_: any, customer: Customer) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar
              size={32}
              style={{
                backgroundColor: avatarColor(customer.companyName),
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {customer.companyName?.charAt(0) || '?'}
            </Avatar>
            <div>
              <div style={{ fontWeight: 600, color: token.colorTextHeading }}>{customer.companyName}</div>
              <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{customer.contactName || '暂无联系人'}</div>
            </div>
          </div>
        ),
      },
      {
        title: '国家',
        dataIndex: 'country',
        key: 'country',
        render: (_: any, record: Customer) => (
          <CountryDisplay country={record.country} />
        ),
      },
      {
        title: '联系人',
        dataIndex: 'contactName',
        key: 'contactName',
        render: (v: string) => v || '-',
      },
      {
        title: '邮箱',
        dataIndex: 'email',
        key: 'email',
        render: (v: string) => v || '-',
      },
      {
        title: '等级',
        key: 'grade',
        render: (_: any, customer: Customer) => {
          const g = getGrade(customer);
          return (
            <span
              style={{
                display: 'inline-block',
                padding: '2px 10px',
                borderRadius: 12,
                backgroundColor: tagColorToBg(g.tagColor, token),
                color: tagColorToHex(g.tagColor, token),
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {g.grade}级
            </span>
          );
        },
      },
      {
        title: '客户类型',
        key: 'customerType',
        render: (_: any, customer: Customer) => {
          const typeLabel = getCustomerTypeLabel(customer);
          if (!typeLabel) return '-';
          const c = tagColorToHex(typeLabel.color, token);
          return (
            <Tag bordered={false} style={{
              margin: 0,
              borderRadius: token.borderRadiusSM,
              fontSize: 11,
              padding: '0px 6px',
              backgroundColor: token.colorBgContainer,
              color: c,
              border: `1px solid ${c}`,
            }}>{typeLabel.label}</Tag>
          );
        },
      },
      {
        title: '订单数',
        dataIndex: '_count',
        key: 'orders',
        render: (v: any) => v?.orders ?? 0,
      },
      {
        title: '合同总额',
        key: 'totalAmount',
        render: (_: any, customer: Customer) => (
          <span style={{ fontWeight: 500 }}>{formatCurrency(customer.totalAmount || 0)}</span>
        ),
      },
      {
        title: '最近下单',
        key: 'lastOrderDate',
        render: (_: any, customer: Customer) =>
          customer.lastOrderDate ? dayjs(customer.lastOrderDate).format('YYYY-MM-DD') : '-',
      },
      {
        title: '标签',
        key: 'tags',
        render: (_: any, customer: Customer) => (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tagsToArray(customer.tags).map((tag) => {
              const c = tagColorToHex(tag.color, token);
              return (
                <Tag key={tag.name} bordered={false} style={{
                  margin: 0,
                  borderRadius: token.borderRadiusSM,
                  fontSize: 11,
                  padding: '0px 6px',
                  backgroundColor: token.colorBgContainer,
                  color: c,
                  border: `1px solid ${c}`,
                }}>{tag.name}</Tag>
              );
            })}
          </div>
        ),
      },
      {
        title: '负责人',
        key: 'owner',
        render: (_: any, customer: Customer) =>
          customer.owner?.realName || customer.owner?.username || <Tag bordered={false}>公海</Tag>,
      },
      {
        title: '操作',
        key: 'action',
        render: (_: any, customer: Customer) => (
          <Space size={8}>
            <a
              style={{ color: token.colorPrimary, fontSize: 13 }}
              onClick={(e) => { e.stopPropagation(); openDetail(customer); }}
            >
              详情
            </a>
            <a
              style={{ color: token.colorTextSecondary, fontSize: 13 }}
              onClick={(e) => { e.stopPropagation(); openDetail(customer); }}
            >
              跟进
            </a>
          </Space>
        ),
      },
    ];

    return (
      <Table
        columns={columns as any}
        dataSource={list}
        rowKey="id"
        loading={loading}
        pagination={false}
        onRow={(customer) => ({
          onClick: () => openDetail(customer),
          style: { cursor: 'pointer' },
        })}
        style={{ backgroundColor: token.colorBgContainer, borderRadius: 16 }}
      />
    );
  }, [list, token, formatCurrency, openDetail, isAdmin, page, pageSize, user, userList]);

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
      <CustomerStats total={total} list={list} token={token} formatCurrency={formatCurrency} />

      {/* 工具栏 */}
      <CustomerToolbar
        token={token}
        keyword={keyword}
        setKeyword={setKeyword}
        fetchData={fetchData}
        setPage={setPage}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isAdmin={isAdmin}
        selectedOwnerId={selectedOwnerId}
        setSelectedOwnerId={setSelectedOwnerId}
        userList={userList}
        filterTags={filterTags}
        setFilterTags={setFilterTags}
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
        onRefresh={fetchData}
        onCustomerUpdated={(updated: Customer) => {
          setDetailCustomer(updated);
          setList((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
        }}
        onCustomerDeleted={() => {
          setDrawerOpen(false);
          fetchData();
        }}
        onTransfer={openTransfer}
        openCreateOrder={openCreateOrder}
        onOrderUpdated={async (customer: Customer) => {
          const fresh = await customerApi.getById(customer.id);
          setDetailCustomer(fresh.data.data);
          const orders = await orderApi.listByCustomer(customer.id);
          setCustomerOrders(orders.data.data);
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
