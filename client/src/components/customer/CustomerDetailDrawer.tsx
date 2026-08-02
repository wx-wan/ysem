import React, { useState, useCallback, useEffect } from 'react';
import {
  Drawer, Space, Tag, Button, Popconfirm, Typography,
  Row, Col, Table, Input, InputNumber,
  Spin, theme, Modal, App, Select, DatePicker, Timeline, Empty, Badge,
} from 'antd';
import {
  UserAddOutlined, ShoppingCartOutlined,
  UserOutlined,
  ClockCircleOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCurrencyStore } from '../../stores/useCurrencyStore';
import { customerApi, Customer, Order, CustomerActivity } from '../../api/customers';
import { salesApi, SalesItem } from '../../api/sales';
import { userApi, User } from '../../api/users';
import CustomerFormModal from './CustomerFormModal';
import CustomerCard from './CustomerCard';

const { Text } = Typography;

interface CustomerDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  customer: Customer | null;
  orders: Order[];
  user: any;
  /** 统一刷新入口：所有内部操作（保存编辑、认领、释放、删除、下单、KeyAccountStar 切换）都调用此方法 */
  onRefresh: (customerId: string) => void;
  onTransfer: (customerId: string) => void;
  openCreateOrder: (customerId: string) => void;
}

const CustomerDetailDrawer = React.memo(function CustomerDetailDrawer({
  open,
  onClose,
  loading,
  customer,
  orders,
  user,
  onRefresh,
  onTransfer,
  openCreateOrder,
}: CustomerDetailDrawerProps) {
  const { token } = theme.useToken();

  // 内部状态
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [activeTab, setActiveTab] = useState<'pipeline' | 'orders' | 'activities'>('pipeline');
  const [pipelines, setPipelines] = useState<SalesItem[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const formatCur = useCurrencyStore((state) => state.format);
  const { message } = App.useApp();

  // 角色判断（必须在 useEffect 之前定义，否则会 TDZ 报错）
  const isAdmin = user?.role?.code === 'admin';
  const isPublic = customer ? !customer.ownerId : true;
  const canOperate = customer ? (isAdmin || customer.ownerId === user?.id) : false;

  // 商机记录 CRUD 状态
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<SalesItem | null>(null);
  const [pipelineForm, setPipelineForm] = useState({ name: '', estimatedAmount: undefined as number | undefined, probability: undefined as string | undefined, expectedCloseDate: '' });
  const [pipelineSaving, setPipelineSaving] = useState(false);

  // 指派相关状态
  const [assignUserId, setAssignUserId] = useState<string>('');
  const [userList, setUserList] = useState<User[]>([]);
  const [assigning, setAssigning] = useState(false);

  // 加载商机记录
  const loadPipelines = useCallback(async () => {
    if (!customer) return;
    setPipelineLoading(true);
    try {
      const res = await salesApi.listByCustomer(customer.id);
      setPipelines(res.data.data);
    } catch {} finally {
      setPipelineLoading(false);
    }
  }, [customer?.id]);

  useEffect(() => {
    if (open && customer) loadPipelines();
  }, [open, customer?.id, loadPipelines]);

  // 加载用户列表（管理员指派用）
  useEffect(() => {
    if (open && isAdmin) {
      userApi.list({ pageSize: 999 }).then((res: any) => {
        setUserList(res.data.data.list || []);
      }).catch(() => {});
    }
  }, [open, isAdmin]);

  // 指派客户到指定业务员
  const handleAssign = useCallback(async () => {
    if (!customer || !assignUserId) return;
    setAssigning(true);
    try {
      await customerApi.transfer(customer.id, assignUserId);
      message.success('指派成功');
      setAssignUserId('');
      onClose();
      onRefresh(customer.id);
    } catch {
      message.error('指派失败');
    } finally {
      setAssigning(false);
    }
  }, [customer, assignUserId, onClose, onRefresh]);

  // 新增商机
  const openCreatePipeline = useCallback(() => {
    setEditingPipeline(null);
    setPipelineForm({ name: '', estimatedAmount: undefined, probability: undefined, expectedCloseDate: '' });
    setPipelineModalOpen(true);
  }, []);

  // 编辑商机
  const openEditPipeline = useCallback((item: SalesItem) => {
    setEditingPipeline(item);
    setPipelineForm({
      name: item.title,
      estimatedAmount: item.estimatedAmount ?? undefined,
      probability: item.probability ?? undefined,
      expectedCloseDate: item.estimatedCloseDate ? dayjs(item.estimatedCloseDate).format('YYYY-MM-DD') : '',
    });
    setPipelineModalOpen(true);
  }, []);

  // 保存商机
  const handleSavePipeline = useCallback(async () => {
    if (!pipelineForm.name || !customer) return;
    setPipelineSaving(true);
    try {
      const payload = {
        stage: 'OPPORTUNITY',
        title: pipelineForm.name,
        customerId: customer.id,
        companyName: customer.companyName,
        estimatedAmount: pipelineForm.estimatedAmount ?? 0,
        probability: pipelineForm.probability,
        estimatedCloseDate: pipelineForm.expectedCloseDate || undefined,
      };
      if (editingPipeline) {
        await salesApi.update(editingPipeline.id, payload as any);
        message.success('商机已更新');
      } else {
        await salesApi.create(payload as any);
        message.success('商机已创建');
      }
      setPipelineModalOpen(false);
      loadPipelines();
      // 同步刷新列表（商机金额可能变化）
      onRefresh(customer.id);
    } catch {
      message.error('操作失败');
    } finally {
      setPipelineSaving(false);
    }
  }, [pipelineForm, customer, editingPipeline, loadPipelines, onRefresh]);

  // 删除商机
  const handleDeletePipeline = useCallback(async (id: string) => {
    try {
      await salesApi.delete(id);
      message.success('商机已删除');
      loadPipelines();
      onRefresh(customer?.id || '');
    } catch {
      message.error('删除失败');
    }
  }, [loadPipelines, onRefresh, customer?.id]);

  // 认领
  const handleClaim = useCallback(async () => {
    if (!customer) return;
    await customerApi.claim(customer.id);
    message.success('认领成功');
    onClose();
    onRefresh(customer.id);
  }, [customer, onClose, onRefresh]);

  // 释放
  const handleRelease = useCallback(async () => {
    if (!customer) return;
    await customerApi.release(customer.id);
    message.success('已释放到公海');
    onClose();
    onRefresh(customer.id);
  }, [customer, onClose, onRefresh]);

  // 删除
  const handleDelete = useCallback(async () => {
    if (!customer) return;
    await customerApi.remove(customer.id);
    message.success('已删除');
    onClose();
    onRefresh(customer.id);
  }, [customer, onClose, onRefresh]);

  // 重置内部状态
  const handleClose = useCallback(() => {
    setShowAllActivities(false);
    onRefresh?.(customer?.id || '');
    onClose();
  }, [onRefresh, onClose]);

  // ========== 渲染函数 ==========

  // 订单表列
  const orderColumns = [
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', render: (v: string) => v || '-' },
    { title: '下单日期', dataIndex: 'orderDate', key: 'orderDate', render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '金额(CNY)', dataIndex: 'amountCNY', key: 'amountCNY', render: (v: number) => formatCur(v || 0) },
    { title: '状态', dataIndex: 'status', key: 'status', render: (v: string) => v || '-' },
  ];

  if (!customer) return null;

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title={
        <Space size={8}>
          <UserOutlined style={{ color: token.colorPrimary }} />
          <span>{customer.companyName || '客户详情'}</span>
          {isPublic && <Tag color="gold" style={{ marginInlineStart: 4 }}>公海</Tag>}
        </Space>
      }
      width={880}
      styles={{
        wrapper: { width: 880, maxWidth: '92vw', borderRadius: '10px 0 0 10px', overflow: 'hidden' },
      }}
      loading={loading}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : (
        <div>
          {/* ===== 公海操作（认领 / 指派） ===== */}
          {isPublic && (
            <div style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button type="primary" icon={<UserAddOutlined />} onClick={handleClaim}>
                认领
              </Button>
              {isAdmin && (
                <>
                  <Select
                    placeholder="选择业务员"
                    value={assignUserId || undefined}
                    onChange={(v) => setAssignUserId(v)}
                    size="middle"
                    style={{ minWidth: 140 }}
                    showSearch
                    options={userList
                      .filter((u: User) => u.status === 'ACTIVE')
                      .map((u: User) => ({ value: u.id, label: u.realName || u.username }))}
                  />
                  <Button loading={assigning} disabled={!assignUserId} onClick={handleAssign}>
                    指派
                  </Button>
                </>
              )}
            </div>
          )}

          {/* ===== 当前客户卡片视图（副本） ===== */}
          <div style={{ marginBottom: 16 }}>
              <CustomerCard
                customer={customer}
                token={token}
                onEdit={() => setEditModalOpen(true)}
                canOperate={canOperate}
                onTransfer={() => onTransfer(customer.id)}
                onRelease={handleRelease}
                onDelete={handleDelete}
              />
          </div>

          {/* ===== 商机 / 订单 / 活动记录 切换 + 常驻操作 ===== */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 16,
            }}
          >
            {/* 左：pill 切换器（配色与卡片视图主筛选栏一致：实心主蓝） */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                background: '#f8fafc',
                borderRadius: 20,
                padding: '3px 4px',
                width: 'fit-content',
              }}
            >
              {[
                { key: 'pipeline' as const, label: '商机记录', count: pipelines.length, icon: <DollarOutlined /> },
                { key: 'orders' as const, label: '订单记录', count: orders?.length ?? 0, icon: <ShoppingCartOutlined /> },
                { key: 'activities' as const, label: '活动记录', count: customer.activities?.length ?? 0, icon: <ClockCircleOutlined /> },
              ].map((opt) => {
                const active = activeTab === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setActiveTab(opt.key)}
                    style={{
                      border: 'none',
                      outline: 'none',
                      cursor: 'pointer',
                      padding: '4px 12px',
                      borderRadius: 16,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      whiteSpace: 'nowrap',
                      transition: 'all 0.2s ease',
                      background: active ? '#1677ff' : 'transparent',
                      color: active ? '#fff' : '#94a3b8',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {opt.icon}
                    {opt.label}
                    {opt.count > 0 && (
                      <Badge
                        count={opt.count}
                        style={{
                          fontSize: 10,
                          lineHeight: 16,
                          height: 16,
                          minWidth: 16,
                          padding: '0 5px',
                          boxShadow: 'none',
                          background: active ? 'rgba(255,255,255,0.9)' : token.colorFillSecondary,
                          color: active ? '#1677ff' : token.colorTextSecondary,
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* 右：当前 tab 的常驻操作 */}
            {activeTab === 'pipeline' && !isPublic && canOperate && (
              <Button type="primary" size="small" icon={<DollarOutlined />} onClick={openCreatePipeline}>
                新增商机
              </Button>
            )}
            {activeTab === 'orders' && !isPublic && canOperate && (
              <Button type="primary" size="small" icon={<ShoppingCartOutlined />} onClick={() => openCreateOrder(customer.id)}>
                下订单
              </Button>
            )}
            {activeTab === 'orders' && !isPublic && !canOperate && (
              <Tag color="default">无操作权限</Tag>
            )}
          </div>

          {/* 商机记录 */}
          {activeTab === 'pipeline' && (
            <div>
              {pipelineLoading ? (
                <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
              ) : pipelines.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ color: token.colorTextSecondary, fontSize: 13 }}>暂无商机记录</span>}
                  style={{ padding: '12px 0' }}
                >
                  {!isPublic && canOperate && (
                    <Button type="primary" size="small" icon={<DollarOutlined />} onClick={openCreatePipeline}>
                      新增第一个商机
                    </Button>
                  )}
                </Empty>
              ) : (
                <Table
                  dataSource={pipelines}
                  rowKey="id"
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: '商机名称',
                      dataIndex: 'title',
                      ellipsis: true,
                    },
                    {
                      title: '预估金额',
                      dataIndex: 'estimatedAmount',
                      width: 120,
                      align: 'right',
                      render: (v: number) => (v != null ? formatCur(v) : '-'),
                    },
                    {
                      title: '采购意向',
                      dataIndex: 'probability',
                      width: 90,
                      align: 'center',
                      render: (v: string) => v || '-',
                    },
                    {
                      title: '预计成交日',
                      dataIndex: 'estimatedCloseDate',
                      width: 110,
                      align: 'center',
                      render: (d: string) => (d ? dayjs(d).format('YYYY-MM-DD') : '-'),
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 100,
                      align: 'center',
                      render: (_: any, record: SalesItem) => (
                        <Space size={0}>
                          <Button type="link" size="small" onClick={() => openEditPipeline(record)}>编辑</Button>
                          <Popconfirm title="确定删除此商机？" onConfirm={() => handleDeletePipeline(record.id)}>
                            <Button type="link" size="small" danger>删除</Button>
                          </Popconfirm>
                        </Space>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          )}

          {/* 订单记录 */}
          {activeTab === 'orders' && (
            <div>
              {(!orders || orders.length === 0) ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span style={{ color: token.colorTextSecondary, fontSize: 13 }}>暂无订单</span>}
                  style={{ padding: '12px 0' }}
                >
                  {!isPublic && canOperate && (
                    <Button size="small" type="primary" onClick={() => openCreateOrder(customer.id)}>
                      <ShoppingCartOutlined /> 去下单
                    </Button>
                  )}
                </Empty>
              ) : (
                <Table
                  dataSource={orders}
                  columns={orderColumns}
                  rowKey="id"
                  size="small"
                  pagination={orders?.length > 10 ? { pageSize: 10, size: 'small' } : false}
                />
              )}
            </div>
          )}

          {/* 活动记录 */}
          {activeTab === 'activities' && (
            <div>
              {customer.activities?.length === 0 ? (
                <div style={{ padding: '16px 0', textAlign: 'center' }}>
                  <Text type="secondary" style={{ fontSize: 13 }}>暂无跟进记录，添加后会显示在这里</Text>
                </div>
              ) : (
                <>
                  <Timeline
                    items={(customer.activities || [])
                      .slice(0, showAllActivities ? undefined : 5)
                      .map((a: CustomerActivity) => ({
                        color: token.colorPrimary,
                        content: (
                          <div style={{ paddingBottom: 2 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                              <Text style={{ fontSize: 13 }}>{a.detail || a.action}</Text>
                              <Text type="secondary" style={{ fontSize: 12 }}>{a.createdBy}</Text>
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {dayjs(a.createdAt).format('MM-DD HH:mm')}
                            </Text>
                          </div>
                        ),
                      }))}
                  />
                  {(customer.activities || []).length > 5 && (
                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                      <Button type="link" size="small" onClick={() => setShowAllActivities(!showAllActivities)}>
                        {showAllActivities ? '收起' : `展开全部 (${customer.activities?.length} 条)`}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* 商机 新增/编辑 弹窗 */}
      <Modal
        title={editingPipeline ? '编辑商机' : '新增商机'}
        open={pipelineModalOpen}
        onCancel={() => setPipelineModalOpen(false)}
        onOk={handleSavePipeline}
        confirmLoading={pipelineSaving}
        okText="保存"
        cancelText="取消"
        width={420}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>商机名称 *</Text>
            <Input
              value={pipelineForm.name}
              onChange={(e) => setPipelineForm({ ...pipelineForm, name: e.target.value })}
              placeholder="请输入商机名称"
              style={{ borderRadius: token.borderRadius }}
            />
          </div>
          <Row gutter={12}>
            <Col span={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>预估金额</Text>
              <InputNumber
                value={pipelineForm.estimatedAmount}
                onChange={(val) => setPipelineForm({ ...pipelineForm, estimatedAmount: val ?? undefined })}
                placeholder="金额"
                min={0}
                precision={2}
                style={{ width: '100%', borderRadius: token.borderRadius }}
                prefix="¥"
              />
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>采购意向</Text>
              <Select
                value={pipelineForm.probability}
                onChange={(val) => setPipelineForm({ ...pipelineForm, probability: val })}
                placeholder="选择意向"
                allowClear
                style={{ width: '100%', borderRadius: token.borderRadius }}
                options={[
                  { label: '低意向', value: '低意向' },
                  { label: '中意向', value: '中意向' },
                  { label: '高意向', value: '高意向' },
                  { label: '准成交', value: '准成交' },
                ]}
              />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>预计成交日期</Text>
            <DatePicker
              style={{ width: '100%', borderRadius: token.borderRadius }}
              value={pipelineForm.expectedCloseDate ? dayjs(pipelineForm.expectedCloseDate) : null}
              onChange={(d) => setPipelineForm({ ...pipelineForm, expectedCloseDate: d ? d.format('YYYY-MM-DD') : '' })}
            />
          </div>
        </div>
      </Modal>

      {/* 编辑客户弹窗 */}
      <CustomerFormModal
        open={editModalOpen}
        editingCustomer={customer}
        onClose={() => setEditModalOpen(false)}
        onSuccess={() => {
          setEditModalOpen(false);
          onRefresh(customer.id);
        }}
      />
    </Drawer>
  );
});

export default CustomerDetailDrawer;
