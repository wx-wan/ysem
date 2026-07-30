import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, Tabs,
  Card, Statistic, Row, Col, message, Popconfirm, Upload, Drawer,
  Tooltip, Dropdown, Badge, Segmented, Typography,
} from 'antd';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, ExportOutlined,
  UploadOutlined, UserSwitchOutlined, TeamOutlined,
  StarOutlined, StarFilled, PhoneOutlined, MailOutlined,
  EnvironmentOutlined, OrderedListOutlined, InboxOutlined,
  ArrowLeftOutlined, ArrowRightOutlined, ShoppingCartOutlined,
  FireOutlined, ClockCircleOutlined, UserAddOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { customerApi, Customer, CustomerActivity } from '../api/customers';
import { orderApi, Order } from '../api/customers';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import dayjs from 'dayjs';

const { Text } = Typography;
const { Dragger } = Upload;

// ========== 意向等级配置 ==========
const INTENT_OPTIONS = [
  { value: 'LOW', label: '低意向', color: '#8b8fa3' },
  { value: 'MEDIUM', label: '中意向', color: '#f0a500' },
  { value: 'HIGH', label: '高意向', color: '#f57c00' },
  { value: 'READY', label: '准成交', color: '#e74c3c' },
];

const INTENT_MAP: Record<string, { label: string; color: string }> = {};
INTENT_OPTIONS.forEach((o) => (INTENT_MAP[o.value] = o));

// ========== 客户类型筛选 ==========
const TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'new', label: '新客户' },
  { value: 'old', label: '老客户' },
  { value: 'key', label: '重点客户' },
  { value: 'noOrder', label: '无订单客户' },
];

export default function CustomersPage() {
  const { t: tRaw } = useTranslation();
  const t = (k: string) => tRaw(k.startsWith('sales.') ? k : `sales.${k}`);
  const { format } = useCurrencyStore();

  // ========== 状态 ==========
  const [activeTab, setActiveTab] = useState<'private' | 'public'>('private');
  const [customerType, setCustomerType] = useState('');
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [stats, setStats] = useState<any>({});
  const [ownerStats, setOwnerStats] = useState<any[]>([]);
  const [publicCount, setPublicCount] = useState(0);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form] = Form.useForm();

  // 详情抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // 订单弹窗
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderCustomerId, setOrderCustomerId] = useState('');
  const [orderForm] = Form.useForm();
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const isAdmin = useMemo(() => {
    const raw = localStorage.getItem('user');
    if (!raw) return false;
    try {
      const u = JSON.parse(raw);
      return u.role === 'admin';
    } catch {
      return false;
    }
  }, []);

  const pageSize = 15;

  // ========== 加载数据 ==========
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, keyword: keyword || undefined };
      if (customerType) params.type = customerType;
      if (selectedOwnerId) params.ownerId = selectedOwnerId;

      if (activeTab === 'private') {
        if (isAdmin && selectedOwnerId) {
          // Admin 按业务员筛选
          const res = await customerApi.listAll({ ...params, ownerId: selectedOwnerId });
          const d = res.data.data;
          setList(d.list);
          setTotal(d.total);
        } else if (isAdmin) {
          // Admin 看所有私海
          const res = await customerApi.listAll(params);
          const d = res.data.data;
          setList(d.list);
          setTotal(d.total);
          setOwnerStats(d.ownerStats || []);
          setPublicCount(d.publicCount);
          setStats(d.stats);
        } else {
          // 普通业务员看自己
          const res = await customerApi.listMy(params);
          const d = res.data.data;
          setList(d.list);
          setTotal(d.total);
          if (d.stats) setStats(d.stats);
        }
      } else {
        const res = await customerApi.listPublic(params);
        const d = res.data.data;
        setList(d.list);
        setTotal(d.total);
      }
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, customerType, activeTab, isAdmin, selectedOwnerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 初始加载时（admin）获取全量统计
  useEffect(() => {
    if (isAdmin && activeTab === 'private') {
      customerApi.listAll({ pageSize: 1 }).then((res) => {
        const d = res.data.data;
        setOwnerStats(d.ownerStats || []);
        setPublicCount(d.publicCount);
        setStats(d.stats);
      }).catch(() => {});
    }
  }, [isAdmin, activeTab]);

  // ========== 打开详情 ==========
  const openDetail = async (customer: Customer) => {
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
  };

  // ========== 创建/编辑弹窗 ==========
  const openCreate = () => {
    setEditingCustomer(null);
    form.resetFields();
    form.setFieldsValue({ isKeyAccount: false });
    setModalOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    form.setFieldsValue({
      companyName: customer.companyName,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      country: customer.country,
      source: customer.source,
      notes: customer.notes,
      isKeyAccount: customer.isKeyAccount,
      intentLevel: customer.intentLevel,
      firstOrderDate: customer.firstOrderDate ? dayjs(customer.firstOrderDate) : null,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingCustomer) {
        await customerApi.update(editingCustomer.id, values);
        message.success('更新成功');
      } else {
        await customerApi.create(values);
        message.success('创建成功');
      }
      setModalOpen(false);
      fetchData();
    } catch (e: any) {
      if (e.errorFields) {
        // antd form validation failed
        return;
      }
      const msg = (e as any)?.response?.data?.message || (e as any)?.message || '操作失败';
      message.error(msg);
    }
  };

  // ========== 认领/释放 ==========
  const handleClaim = async (id: string) => {
    await customerApi.claim(id);
    message.success('认领成功');
    fetchData();
  };

  const handleRelease = async (id: string) => {
    await customerApi.release(id);
    message.success('已释放到公海');
    fetchData();
  };

  // ========== 删除 ==========
  const handleDelete = async (id: string) => {
    try {
      await customerApi.remove(id);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '删除失败';
      message.error(msg);
    }
  };

  // ========== 导入 ==========
  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    try {
      const res = await customerApi.importExcel(importFile);
      const data = res.data.data;
      message.success(`导入完成：成功 ${data.created} 条${data.failed > 0 ? `，失败 ${data.failed} 条` : ''}`);
      setImportOpen(false);
      setImportFile(null);
      fetchData();
    } catch {
      message.error('导入失败');
    } finally {
      setImporting(false);
    }
  };

  // ========== 订单弹窗 ==========
  const openCreateOrder = (customerId: string) => {
    setEditingOrder(null);
    setOrderCustomerId(customerId);
    orderForm.resetFields();
    orderForm.setFieldsValue({ status: 'PENDING' });
    setOrderModalOpen(true);
  };

  const handleSaveOrder = async () => {
    try {
      const values = await orderForm.validateFields();
      if (editingOrder) {
        await orderApi.update(editingOrder.id, values);
        message.success('更新成功');
      } else {
        await orderApi.create({ ...values, customerId: orderCustomerId });
        message.success('创建成功');
      }
      setOrderModalOpen(false);

      // Refresh detail
      if (detailCustomer) {
        const fresh = await customerApi.getById(detailCustomer.id);
        setDetailCustomer(fresh.data.data);
        const orders = await orderApi.listByCustomer(detailCustomer.id);
        setCustomerOrders(orders.data.data);
      }
    } catch (e: any) {
      if (e.errorFields) return;
      const msg = e?.response?.data?.message || e?.message || '操作失败';
      message.error(msg);
    }
  };

  // ========== 新老客户判断 ==========
  const customerTagInfo = (customer: Customer) => {
    if (customer.isKeyAccount) {
      const intent = INTENT_MAP[customer.intentLevel || ''] || INTENT_MAP['LOW'];
      return {
        text: `重点 (${intent.label})`,
        color: intent.color,
        icon: <StarFilled />,
      };
    }
    if (!customer.firstOrderDate) {
      return { text: '无订单', color: '#8b8fa3', icon: <ClockCircleOutlined /> };
    }
    const year = customer.firstOrderDate.substring(0, 4);
    const currentYear = String(new Date().getFullYear());
    if (year === currentYear) {
      return { text: '新客户', color: '#52c41a', icon: <FireOutlined /> };
    }
    return { text: '老客户', color: '#1890ff', icon: <TeamOutlined /> };
  };

  // ========== 列定义 ==========
  const getColumns = () => {
    const base = [
      {
        title: '公司名称',
        dataIndex: 'companyName',
        key: 'companyName',
        width: 200,
        render: (v: string, r: Customer) => (
          <a
            onClick={() => openDetail(r)}
            style={{ fontWeight: 500 }}
          >
            {v}
          </a>
        ),
      },
      {
        title: '联系人',
        dataIndex: 'contactName',
        key: 'contactName',
        width: 100,
        render: (v: string) => v || '-',
      },
      {
        title: '类型',
        key: 'type',
        width: 130,
        render: (_: any, r: Customer) => {
          const info = customerTagInfo(r);
          return (
            <Tag color={info.color} icon={info.icon}>
              {info.text}
            </Tag>
          );
        },
      },
      {
        title: '国家',
        dataIndex: 'country',
        key: 'country',
        width: 100,
        render: (v: string) => v || '-',
      },
      {
        title: '订单数',
        key: 'orderCount',
        width: 70,
        align: 'center' as const,
        render: (_: any, r: Customer) => r._count?.orders ?? 0,
      },
      {
        title: '线索数',
        key: 'pipelineCount',
        width: 70,
        align: 'center' as const,
        render: (_: any, r: Customer) => r._count?.pipelines ?? 0,
      },
      // Admin 模式下显示归属
      ...(isAdmin && activeTab === 'private'
        ? [
            {
              title: '负责人',
              dataIndex: 'owner',
              key: 'owner',
              width: 100,
              render: (v: any) => v?.realName || v?.username || '-',
            },
          ]
        : []),
      {
        title: '操作',
        key: 'action',
        width: activeTab === 'public' ? 200 : 240,
        fixed: 'right' as const,
        render: (_: any, r: Customer) => (
          <Space size="small">
            <Button type="link" size="small" onClick={() => openCreateOrder(r.id)}>
              下单
            </Button>
            {activeTab === 'public' ? (
              <Button type="primary" size="small" icon={<UserAddOutlined />} onClick={() => handleClaim(r.id)}>
                认领
              </Button>
            ) : (
              <>
                <Button type="link" size="small" onClick={() => openEdit(r)}>
                  编辑
                </Button>
                <Popconfirm title="确认释放到公海？" onConfirm={() => handleRelease(r.id)}>
                  <Button type="link" size="small" danger>
                    释放
                  </Button>
                </Popconfirm>
                <Popconfirm title="确认删除？" onConfirm={() => handleDelete(r.id)}>
                  <Button type="link" size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            )}
          </Space>
        ),
      },
    ];
    return base;
  };

  // ========== 渲染 ==========
  const renderStatsBar = () => {
    if (activeTab === 'public') {
      return (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card size="small">
              <Statistic title="公海客户总数" value={publicCount || total} />
            </Card>
          </Col>
        </Row>
      );
    }

    return (
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic title="总计" value={stats.total ?? total} valueStyle={{ fontSize: 20 }} />
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" style={{ borderTop: '3px solid #52c41a' }}>
            <Statistic
              title={<span><FireOutlined style={{ color: '#52c41a' }} /> 新客户</span>}
              value={stats.newCount ?? 0}
              valueStyle={{ fontSize: 20, color: '#52c41a' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>今年首次下单</Text>
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" style={{ borderTop: '3px solid #1890ff' }}>
            <Statistic
              title={<span><TeamOutlined style={{ color: '#1890ff' }} /> 老客户</span>}
              value={stats.oldCount ?? 0}
              valueStyle={{ fontSize: 20, color: '#1890ff' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>往年已下单</Text>
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" style={{ borderTop: '3px solid #f0a500' }}>
            <Statistic
              title={<span><StarFilled style={{ color: '#f0a500' }} /> 重点客户</span>}
              value={stats.keyCount ?? 0}
              valueStyle={{ fontSize: 20, color: '#f0a500' }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              {INTENT_OPTIONS.map((io) => {
                const c = stats.intentBreakdown?.find((i: any) => i.level === io.value)?.count || 0;
                return c > 0 ? `${io.label}${c} ` : '';
              })}
            </Text>
          </Card>
        </Col>
        <Col span={5}>
          <Card size="small" style={{ borderTop: '3px solid #8b8fa3' }}>
            <Statistic
              title={<span><ClockCircleOutlined /> 无订单</span>}
              value={(stats.noOrderCount ?? stats.total - (stats.newCount + stats.oldCount + stats.keyCount)) ?? 0}
              valueStyle={{ fontSize: 20, color: '#8b8fa3' }}
            />
          </Card>
        </Col>
      </Row>
    );
  };

  const renderAdminOwnerFilter = () => {
    if (!isAdmin || activeTab !== 'private') return null;
    return (
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Text strong style={{ marginRight: 4 }}>业务员：</Text>
        <Segmented
          options={[
            { value: '', label: `全部 (${stats.total ?? total})` },
            ...(ownerStats || []).map((o: any) => ({
              value: o.id,
              label: `${o.realName || o.username} (${o.customerCount})`,
            })),
          ]}
          value={selectedOwnerId}
          onChange={(v) => {
            setSelectedOwnerId(v as string);
            setPage(1);
          }}
        />
        <div style={{ flex: 1 }} />
        <Text type="secondary">
          <TeamOutlined /> 公海：{publicCount} 个客户
        </Text>
      </div>
    );
  };

  const renderToolbar = () => (
    <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Input.Search
        placeholder="搜索公司/联系/邮箱"
        style={{ width: 240 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onSearch={() => { setPage(1); fetchData(); }}
        allowClear
      />
      {activeTab === 'private' && (
        <Segmented
          options={TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          value={customerType}
          onChange={(v) => { setCustomerType(v as string); setPage(1); }}
        />
      )}
      <div style={{ flex: 1 }} />
      <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
        导入
      </Button>
      <Button icon={<ReloadOutlined />} onClick={fetchData}>
        刷新
      </Button>
      <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
        新增客户
      </Button>
    </div>
  );

  return (
    <div style={{ padding: '0 0 24px' }}>
      <h2 style={{ marginBottom: 16 }}>客户管理</h2>

      {/* Tab 切换 */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => {
          setActiveTab(k as 'private' | 'public');
          setPage(1);
          setCustomerType('');
          setSelectedOwnerId('');
        }}
        style={{ marginBottom: 0 }}
        items={[
          {
            key: 'private',
            label: <span><UserSwitchOutlined /> 私海客户</span>,
          },
          {
            key: 'public',
            label: (
              <Badge count={publicCount || undefined} size="small" offset={[6, 0]}>
                <span><TeamOutlined /> 公海客户</span>
              </Badge>
            ),
          },
        ]}
      />

      {/* 统计卡片 */}
      {renderStatsBar()}

      {/* 管理员：按业务员筛选 */}
      {renderAdminOwnerFilter()}

      {/* 工具栏 */}
      {renderToolbar()}

      {/* 表格 */}
      <Table
        rowKey="id"
        columns={getColumns()}
        dataSource={list}
        loading={loading}
        scroll={{ x: 900 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: (p) => setPage(p),
        }}
        size="middle"
      />

      {/* ===== 创建/编辑弹窗 ===== */}
      <Modal
        title={editingCustomer ? '编辑客户' : '新增客户'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
            <Input placeholder="公司名称" />
          </Form.Item>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="contactName" label="联系人" style={{ width: 190 }}>
              <Input placeholder="联系人" />
            </Form.Item>
            <Form.Item name="email" label="邮箱" style={{ width: 190 }}>
              <Input placeholder="邮箱" />
            </Form.Item>
            <Form.Item name="phone" label="电话" style={{ width: 190 }}>
              <Input placeholder="电话" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="country" label="国家" style={{ width: 190 }}>
              <Input placeholder="国家" />
            </Form.Item>
            <Form.Item name="source" label="来源" style={{ width: 190 }}>
              <Select placeholder="来源" allowClear>
                <Select.Option value="MANUAL">手动录入</Select.Option>
                <Select.Option value="EXCEL">Excel导入</Select.Option>
                <Select.Option value="XIAOMAN">小满API</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="isKeyAccount" label="重点客户" style={{ width: 190 }} valuePropName="checked">
              <Select>
                <Select.Option value={false}>否</Select.Option>
                <Select.Option value={true}>是</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.isKeyAccount !== cur.isKeyAccount}
          >
            {({ getFieldValue }) =>
              getFieldValue('isKeyAccount') ? (
                <Space>
                  <Form.Item name="intentLevel" label="意向等级">
                    <Select placeholder="选择意向等级" style={{ width: 160 }}>
                      {INTENT_OPTIONS.map((o) => (
                        <Select.Option key={o.value} value={o.value}>
                          <Tag color={o.color}>{o.label}</Tag>
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item name="firstOrderDate" label="首次订单日期">
                    <Input type="date" />
                  </Form.Item>
                </Space>
              ) : null
            }
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== 详情抽屉 ===== */}
      <Drawer
        title={detailCustomer?.companyName || '客户详情'}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={680}
        loading={detailLoading}
        extra={
          detailCustomer && (
            <Space>
              <Button onClick={() => { openCreateOrder(detailCustomer.id); }}>
                <ShoppingCartOutlined /> 下订单
              </Button>
              <Button onClick={() => openEdit(detailCustomer)}>
                编辑
              </Button>
            </Space>
          )
        }
      >
        {detailCustomer && (
          <div>
            {/* 基本信息 */}
            <Card size="small" title="基本信息" style={{ marginBottom: 16 }}>
              <Row gutter={[16, 12]}>
                <Col span={12}><Text type="secondary">公司名称</Text><br /><Text strong>{detailCustomer.companyName}</Text></Col>
                <Col span={12}><Text type="secondary">联系人</Text><br /><Text>{detailCustomer.contactName || '-'}</Text></Col>
                <Col span={12}>
                  <Text type="secondary">邮箱</Text><br />
                  {detailCustomer.email ? <a href={`mailto:${detailCustomer.email}`}><MailOutlined /> {detailCustomer.email}</a> : '-'}
                </Col>
                <Col span={12}>
                  <Text type="secondary">电话</Text><br />
                  {detailCustomer.phone ? <><PhoneOutlined /> {detailCustomer.phone}</> : '-'}
                </Col>
                <Col span={12}><Text type="secondary">国家</Text><br /><Text>{detailCustomer.country || '-'}</Text></Col>
                <Col span={12}><Text type="secondary">来源</Text><br /><Text>{detailCustomer.source || '-'}</Text></Col>
                <Col span={12}><Text type="secondary">负责人</Text><br /><Text>{detailCustomer.owner?.realName || detailCustomer.owner?.username || <Tag>公海</Tag>}</Text></Col>
                <Col span={12}>
                  <Text type="secondary">类型</Text><br />
                  {(() => {
                    const i = customerTagInfo(detailCustomer);
                    return <Tag color={i.color} icon={i.icon}>{i.text}</Tag>;
                  })()}
                </Col>
                {detailCustomer.firstOrderDate && (
                  <Col span={12}><Text type="secondary">首次下单</Text><br /><Text>{detailCustomer.firstOrderDate}</Text></Col>
                )}
                {detailCustomer.notes && (
                  <Col span={24}><Text type="secondary">备注</Text><br /><Text>{detailCustomer.notes}</Text></Col>
                )}
              </Row>
            </Card>

            {/* 订单列表 */}
            <Card
              size="small"
              title={<span><ShoppingCartOutlined /> 订单记录 ({customerOrders.length})</span>}
              style={{ marginBottom: 16 }}
              extra={
                <Button size="small" type="link" onClick={() => openCreateOrder(detailCustomer.id)}>
                  新增
                </Button>
              }
            >
              {customerOrders.length === 0 ? (
                <Text type="secondary">暂无订单</Text>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <th style={{ textAlign: 'left', padding: 8 }}>订单号</th>
                      <th style={{ textAlign: 'left', padding: 8 }}>日期</th>
                      <th style={{ textAlign: 'right', padding: 8 }}>金额(CNY)</th>
                      <th style={{ textAlign: 'center', padding: 8 }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerOrders.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid #fafafa' }}>
                        <td style={{ padding: 8 }}>{o.orderNo || '-'}</td>
                        <td style={{ padding: 8 }}>{o.orderDate || '-'}</td>
                        <td style={{ padding: 8, textAlign: 'right', fontWeight: 500 }}>
                          ¥{(o.amountCNY ?? 0).toLocaleString()}
                        </td>
                        <td style={{ padding: 8, textAlign: 'center' }}>
                          <Tag>{o.status || 'PENDING'}</Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {/* 活动日志 */}
            <Card size="small" title="活动记录">
              {detailCustomer.activities?.length === 0 ? (
                <Text type="secondary">暂无记录</Text>
              ) : (
                <div>
                  {(detailCustomer.activities || []).map((a: CustomerActivity) => (
                    <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #fafafa', display: 'flex', gap: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 90 }}>
                        {dayjs(a.createdAt).format('MM-DD HH:mm')}
                      </Text>
                      <Text style={{ fontSize: 13 }}>{a.detail || a.action}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{a.createdBy}</Text>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </Drawer>

      {/* ===== 导入弹窗 ===== */}
      <Modal
        title="Excel 导入客户"
        open={importOpen}
        onOk={handleImport}
        onCancel={() => { setImportOpen(false); setImportFile(null); }}
        confirmLoading={importing}
        okText="开始导入"
      >
        <Dragger
          accept=".xlsx,.xls,.csv"
          maxCount={1}
          beforeUpload={(file) => {
            setImportFile(file);
            return false;
          }}
          onRemove={() => setImportFile(null)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p>点击或拖拽文件上传</p>
          <p style={{ color: '#8b8fa3', fontSize: 12 }}>
            支持 .xlsx / .xls / .csv，表头支持：公司名称、联系人、邮箱、电话、国家
          </p>
        </Dragger>
      </Modal>

      {/* ===== 订单弹窗 ===== */}
      <Modal
        title={editingOrder ? '编辑订单' : '新增订单'}
        open={orderModalOpen}
        onOk={handleSaveOrder}
        onCancel={() => setOrderModalOpen(false)}
        width={560}
        destroyOnHidden
      >
        <Form form={orderForm} layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="orderNo" label="订单号" style={{ width: 170 }}>
              <Input placeholder="订单号" />
            </Form.Item>
            <Form.Item name="orderDate" label="订单日期" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="amountCNY" label="金额 (CNY)" style={{ width: 170 }}>
              <Input type="number" placeholder="0.00" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="deliveryDate" label="交付日期" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="paymentTerms" label="付款条件" style={{ width: 170 }}>
              <Input placeholder="如 T/T 30%" />
            </Form.Item>
            <Form.Item name="status" label="状态" style={{ width: 170 }}>
              <Select>
                <Select.Option value="PENDING">待确认</Select.Option>
                <Select.Option value="CONFIRMED">已确认</Select.Option>
                <Select.Option value="IN_PRODUCTION">生产中</Select.Option>
                <Select.Option value="SHIPPED">已发货</Select.Option>
                <Select.Option value="DELIVERED">已交付</Select.Option>
              </Select>
            </Form.Item>
          </Space>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
