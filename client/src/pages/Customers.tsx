import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Button, Modal, Form, Input, Select, Tag, Space, Card,
  Row, Col, App, Popconfirm, Upload, Drawer, Segmented,
  Typography, Avatar, Spin, theme, Table, Badge,
  Popover,
} from 'antd';
import { PieChart, Pie, Cell } from 'recharts';
import {
  PlusOutlined, SearchOutlined, ReloadOutlined, UploadOutlined,
  UserSwitchOutlined, TeamOutlined, StarFilled,
  PhoneOutlined, MailOutlined, ShoppingCartOutlined,
  InboxOutlined, UserAddOutlined,
  GlobalOutlined, AppstoreOutlined, UnorderedListOutlined,
  ArrowRightOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { customerApi, Customer, CustomerActivity } from '../api/customers';
import { orderApi, Order } from '../api/customers';
import { userApi, User } from '../api/users';
import dayjs from 'dayjs';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { useAuthStore } from '../stores/useAuthStore';
import KeyAccountStar from '../components/KeyAccountStar';

const { Text } = Typography;
const { Dragger } = Upload;

// ========== 国家组件 ==========
import CountrySelect from '../components/CountrySelect';
import CountryDisplay from '../components/CountryDisplay';
import { getCountryFlag, findCountry } from '../data/countries';

// ========== 状态色值映射 ==========
const STATUS_MAP: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  lead:    { label: '线索',    color: '#1677ff', bg: '#e6f4ff', dot: '#1677ff' },
  prospect:{ label: '商机',    color: '#52c41a', bg: '#f6ffed', dot: '#52c41a' },
  sample:  { label: '样品单',   color: '#fa8c16', bg: '#fff7e6', dot: '#fa8c16' },
  order:   { label: '已订单',   color: '#f5222d', bg: '#fff1f0', dot: '#f5222d' },
};

// ========== 采购意向配置 ==========
const INTENT_OPTIONS = [
  { value: 'LOW', label: '低意向', color: '#8b8fa3' },
  { value: 'MEDIUM', label: '中意向', color: '#f0a500' },
  { value: 'HIGH', label: '高意向', color: '#f57c00' },
  { value: 'READY', label: '准成交', color: '#e74c3c' },
];

const INTENT_MAP: Record<string, { label: string; color: string }> = {};
INTENT_OPTIONS.forEach((o) => (INTENT_MAP[o.value] = o));

// ========== 客户等级（A/B/C/D 四级 + 红/橙/黄/绿 颜色区分） ==========
const getGrade = (customer: Customer): { grade: 'A' | 'B' | 'C' | 'D'; color: string; bg: string } => {
  if (customer.isKeyAccount && customer.intentLevel === 'HIGH') {
    return { grade: 'A', color: '#fff', bg: '#e74c3c' }; // 红色：重点客户
  }
  if (customer.isKeyAccount || customer.intentLevel === 'HIGH') {
    return { grade: 'B', color: '#fff', bg: '#fa8c16' }; // 橙色：重要/高意向客户
  }
  if (customer.intentLevel === 'MEDIUM') {
    return { grade: 'C', color: '#fff', bg: '#f0a500' }; // 黄色：中等意向客户
  }
  return { grade: 'D', color: '#fff', bg: '#52c41a' }; // 绿色：普通/低意向客户
};

// ========== 客户标签生成 ==========
const getCustomerTags = (customer: Customer): string[] => {
  const tags: string[] = [];
  if (customer.isKeyAccount) tags.push('重点客户');
  if (customer.intentLevel === 'HIGH') tags.push('高意向');
  if (customer.intentLevel === 'MEDIUM') tags.push('中意向');
  if (customer.status === 'order') tags.push('年框协议');
  if (customer.source === 'EXCEL') tags.push('批量导入');
  else if (customer.source && customer.source !== 'MANUAL') tags.push(customer.source);
  if (tags.length === 0) {
    if (customer._count?.orders && customer._count.orders > 0) tags.push('长期合作');
    else tags.push('潜在客户');
  }
  return tags.slice(0, 3);
};

// ========== 金额格式化（使用 store 的 format 方法） ==========
// Note: formatAmount/formatAmountFull 已被 useCurrencyStore.format 替代

// ========== 客户类型筛选 ==========
const TYPE_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'new', label: '新客户' },
  { value: 'old', label: '老客户' },
  { value: 'key', label: '重点客户' },
  { value: 'noOrder', label: '无订单客户' },
];

// ========== 标签颜色配置 ==========
const TAG_PRESET_COLORS = [
  '#f50', '#2db7f5', '#87d068', '#108ee9',
  '#ff4d4f', '#faad14', '#52c41a', '#722ed1',
];

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

// 将标签数组序列化为 tags 字符串
function tagsArrayToString(tags: { name: string; color?: string }[]): string {
  return tags.map(t => t.color ? `${t.name}#${t.color}` : t.name).join(',');
}

// 标签颜色编辑器组件
function TagColorEditor({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const tags = tagsToArray(value);
  const [inputValue, setInputValue] = useState('');
  const [selectedColor, setSelectedColor] = useState(TAG_PRESET_COLORS[0]);

  const addTag = () => {
    const name = inputValue.trim();
    if (!name) return;
    if (tags.some(t => t.name === name)) {
      setInputValue('');
      return;
    }
    const newTags = [...tags, { name, color: selectedColor }];
    onChange?.(tagsArrayToString(newTags));
    setInputValue('');
  };

  const removeTag = (index: number) => {
    const newTags = tags.filter((_, i) => i !== index);
    onChange?.(tagsArrayToString(newTags));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
        <Input
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onPressEnter={addTag}
          placeholder="输入标签名称"
          style={{ flex: 1 }}
        />
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {TAG_PRESET_COLORS.map(c => (
            <div
              key={c}
              onClick={() => setSelectedColor(c)}
              style={{
                width: selectedColor === c ? 26 : 22,
                height: selectedColor === c ? 26 : 22,
                borderRadius: '50%',
                backgroundColor: c,
                cursor: 'pointer',
                border: selectedColor === c ? '2px solid #fff' : '2px solid transparent',
                boxShadow: selectedColor === c ? `0 0 0 2px ${c}` : 'none',
                boxSizing: 'border-box',
                transition: 'all 0.15s ease',
                flexShrink: 0,
              }}
            />
          ))}
        </div>
        <Button type="primary" size="small" onClick={addTag}>添加</Button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {tags.map((tag, i) => (
          <Tag
            key={tag.name}
            color={tag.color}
            closable
            onClose={() => removeTag(i)}
            style={{ borderRadius: 10, margin: 0 }}
          >
            {tag.name}
          </Tag>
        ))}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  const { t: tRaw } = useTranslation();
  const t = (k: string) => tRaw(k.startsWith('sales.') ? k : `sales.${k}`);
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { format: formatCurrency } = useCurrencyStore();

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
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');

  // 弹窗
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [form] = Form.useForm();

  // 详情抽屉
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [customerOrders, setCustomerOrders] = useState<Order[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [drawerEditing, setDrawerEditing] = useState(false);
  const [drawerSaving, setDrawerSaving] = useState(false);
  const [drawerEditValues, setDrawerEditValues] = useState<Record<string, any>>({});

  // 导入
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  // 订单弹窗
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderCustomerId, setOrderCustomerId] = useState('');
  const [orderForm] = Form.useForm();
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role?.code === 'admin';

  const pageSize = 12;

  // ========== 加载数据 ==========
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, keyword: keyword || undefined };
      if (customerType) params.type = customerType;

      if (activeTab === 'private') {
        if (isAdmin) {
          // 管理员：支持按业务员筛选
          if (selectedOwnerId) params.ownerId = selectedOwnerId;
          const res = await customerApi.listAll(params);
          const d = res.data.data;
          setList(d.list);
          setTotal(d.total);
          if (!selectedOwnerId) {
            setOwnerStats(d.ownerStats || []);
            setPublicCount(d.publicCount);
            setStats(d.stats);
          }
        } else {
          // 普通用户：只能看自己的客户
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

  // 加载用户列表（用于筛选和转交）
  useEffect(() => {
    userApi.list({ pageSize: 200 }).then((res) => {
      setUserList(res.data.data?.list || []);
    }).catch(() => {});
  }, []);

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
    setShowAllActivities(false);
    setDrawerEditing(false);
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

  // ========== 抽屉编辑 ==========
  const enterDrawerEdit = () => {
    if (!detailCustomer) return;
    setDrawerEditValues({
      companyName: detailCustomer.companyName || '',
      contactName: detailCustomer.contactName || '',
      email: detailCustomer.email || '',
      phone: detailCustomer.phone || '',
      country: detailCustomer.country || '',
      source: detailCustomer.source || '',
      isKeyAccount: detailCustomer.isKeyAccount || false,
      intentLevel: detailCustomer.intentLevel || undefined,
      tags: detailCustomer.tags || '',
      firstOrderDate: detailCustomer.firstOrderDate || '',
      notes: detailCustomer.notes || '',
    });
    setDrawerEditing(true);
  };

  const handleDrawerSave = async () => {
    if (!detailCustomer) return;
    setDrawerSaving(true);
    try {
      await customerApi.update(detailCustomer.id, drawerEditValues as any);
      const updated = { ...detailCustomer, ...drawerEditValues };
      setDetailCustomer(updated);
      setList((prev) =>
        prev.map((c) => (c.id === detailCustomer.id ? { ...c, ...drawerEditValues } : c))
      );
      message.success('保存成功');
      setDrawerEditing(false);
    } catch {
      message.error('保存失败');
    } finally {
      setDrawerSaving(false);
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
      tags: customer.tags || '',
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
      if (e.errorFields) return;
      const msg = (e as any)?.response?.data?.message || (e as any)?.message || '操作失败';
      message.error(msg);
    }
  };

  // ========== 认领/释放 ==========
  const handleClaim = async (id: string) => {
    await customerApi.claim(id);
    message.success('认领成功');
    fetchData();
    // 如果抽屉打开的是该客户，刷新详情
    if (detailCustomer?.id === id) {
      const res = await customerApi.getById(id);
      setDetailCustomer(res.data.data);
      setDrawerEditValues({
        companyName: res.data.data.companyName,
        contactName: res.data.data.contactName,
        email: res.data.data.email,
        phone: res.data.data.phone,
        country: res.data.data.country,
        source: res.data.data.source,
        notes: res.data.data.notes,
        isKeyAccount: res.data.data.isKeyAccount || false,
        intentLevel: res.data.data.intentLevel || undefined,
        tags: res.data.data.tags || '',
        firstOrderDate: res.data.data.firstOrderDate || '',
      });
    }
  };

  const handleRelease = async (id: string) => {
    await customerApi.release(id);
    message.success('已释放到公海');
    fetchData();
    if (detailCustomer?.id === id) {
      const res = await customerApi.getById(id);
      setDetailCustomer(res.data.data);
      setDrawerEditValues({
        companyName: res.data.data.companyName,
        contactName: res.data.data.contactName,
        email: res.data.data.email,
        phone: res.data.data.phone,
        country: res.data.data.country,
        source: res.data.data.source,
        notes: res.data.data.notes,
        isKeyAccount: res.data.data.isKeyAccount || false,
        intentLevel: res.data.data.intentLevel || undefined,
        tags: res.data.data.tags || '',
        firstOrderDate: res.data.data.firstOrderDate || '',
      });
    }
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

  // ========== 转交 ==========
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferCustomerId, setTransferCustomerId] = useState<string>('');
  const [transferTargetId, setTransferTargetId] = useState<string>('');
  const [userList, setUserList] = useState<User[]>([]);

  const openTransfer = (customerId: string) => {
    setTransferCustomerId(customerId);
    setTransferTargetId('');
    setTransferModalOpen(true);
  };

  const handleTransfer = async () => {
    if (!transferTargetId) {
      message.error('请选择目标业务员');
      return;
    }
    try {
      await customerApi.transfer(transferCustomerId, transferTargetId);
      message.success('转交成功');
      setTransferModalOpen(false);
      if (drawerOpen) {
        setDrawerOpen(false);
      }
      fetchData();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message || '转交失败';
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

  // ========== 头像颜色 ==========
  const avatarColor = (name?: string) => {
    const colors = ['#1677ff', '#52c41a', '#fa8c16', '#f5222d', '#13c2c2', '#722ed1', '#eb2f96', '#fa541c'];
    if (!name) return colors[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  };

  // ========== 统计数据 ==========
  const statsData = useMemo(() => {
    const totalCustomers = total;
    const aGradeCount = list.filter((c) => getGrade(c).grade === 'A').length;
    const totalContract = list.reduce((sum, c) => sum + (c.totalAmount || 0), 0);
    return { totalCustomers, aGradeCount, totalContract };
  }, [list, total]);

  const countryStats = useMemo(() => {
    const map: Record<string, number> = {};
    list.filter(c => c.country).forEach(c => {
      map[c.country] = (map[c.country] || 0) + 1;
    });
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    return Object.entries(map)
      .map(([name, count]) => ({ name, count, pct: total ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [list]);

  // ========== 渲染统计卡片 ==========
  const renderStats = () => (
    <Row gutter={16} style={{ marginBottom: 24 }}>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              🌍
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', lineHeight: 1 }}>{statsData.totalCustomers}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>客户总数</div>
              <Popover
                content={
                  (() => {
                    const COLORS = ['#1677ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2', '#f5222d', '#faad14', '#2f54eb', '#a0d911'];
                    return (
                      <div style={{ width: 240, textAlign: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#1a1a2e' }}>国家/地区分布</div>
                        <div className="popover-chart-flex" style={{ display: 'flex', justifyContent: 'center' }}>
                          <PieChart width={180} height={180} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                            <Pie
                              data={countryStats}
                              dataKey="count"
                              nameKey="name"
                              cx={90}
                              cy={90}
                              innerRadius={50}
                              outerRadius={78}
                              stroke="none"
                            >
                              {countryStats.map((c, i) => (
                                <Cell key={c.name} fill={COLORS[i % COLORS.length]} />
                              ))}
                            </Pie>
                            <foreignObject x="50%" y="50%" width="1" height="1">
                              <div style={{ transform: 'translate(-50%, -50%)', textAlign: 'center', lineHeight: 1.2, pointerEvents: 'none' }}>
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a2e' }}>{countryStats.length}</div>
                                <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>个国家/地区</div>
                              </div>
                            </foreignObject>
                          </PieChart>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 8, justifyContent: 'center' }}>
                          {countryStats.map((c, i) => (
                            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#666' }}>
                              <span style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], flexShrink: 0 }} />
                              <span style={{ whiteSpace: 'nowrap' }}>{c.name} {c.pct}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                }
                title={null}
              >
                <div style={{ fontSize: 12, color: '#1677ff', marginTop: 2, cursor: 'pointer' }}>{countryStats.length} 个国家/地区</div>
              </Popover>
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              ⭐
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', lineHeight: 1 }}>{statsData.aGradeCount}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>A级客户</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>战略合作伙伴</div>
            </div>
          </div>
        </Card>
      </Col>
      <Col xs={24} sm={8}>
        <Card
          style={{ borderRadius: 16, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
          styles={{ body: { padding: '20px 24px' } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
              🏦
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', lineHeight: 1 }}>{formatCurrency(statsData.totalContract || 0)}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>累计合同额</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>今年度</div>
            </div>
          </div>
        </Card>
      </Col>
    </Row>
  );

  // ========== 渲染工具栏 ==========
  const renderToolbar = () => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
      <Input
        prefix={<SearchOutlined style={{ color: '#999' }} />}
        placeholder="搜索客户名、国家、联系人..."
        style={{ width: 320, borderRadius: 8, height: 36 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => { setPage(1); fetchData(); }}
        allowClear
      />

      <Segmented
        className="view-mode-segmented"
        value={viewMode}
        onChange={(v) => setViewMode(v as 'card' | 'list')}
        options={[
          { value: 'card', label: <span><AppstoreOutlined style={{ marginRight: 4 }} />卡片</span> },
          { value: 'list', label: <span><UnorderedListOutlined style={{ marginRight: 4 }} />列表</span> },
        ]}
      />

      {isAdmin && activeTab === 'private' && (
      <Select
        placeholder="筛选业务员"
        value={selectedOwnerId || undefined}
        onChange={(v) => { setSelectedOwnerId(v || ''); setPage(1); }}
        allowClear
        style={{ width: 180, borderRadius: 8 }}
        showSearch
        filterOption={(input, option: any) =>
          option?.label?.toLowerCase().includes(input.toLowerCase())
        }
        options={userList
          .filter((u: User) => u.status === 'ACTIVE')
          .map((u: User) => ({
            value: u.id,
            label: u.realName || u.username,
          }))}
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

  // ========== 渲染卡片视图 ==========
  const renderCardView = () => (
    <Row gutter={[16, 16]}>
      {list.map((customer) => {
        const grade = getGrade(customer);
        const ownerName = customer.owner?.realName || customer.owner?.username || '';
        const firstChar = ownerName?.charAt(0) || customer.contactName?.charAt(0) || customer.companyName?.charAt(0) || '?';
        const bgColor = avatarColor(ownerName || customer.companyName);

        return (
          <Col xs={24} sm={12} md={8} lg={8} xl={8} key={customer.id}>
            <Card
              hoverable
              onClick={() => openDetail(customer)}
              style={{
                borderRadius: 16,
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                cursor: 'pointer',
                height: '100%',
                overflow: 'hidden',
                backgroundColor: 'transparent',
              }}
              styles={{ body: { padding: 0, backgroundColor: 'transparent' } }}
            >
              {/* 彩色头部区域 */}
              <div
                style={{
                  backgroundColor: grade.bg,
                  padding: '18px 20px 20px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* 装饰性圆环 */}
                <div style={{
                  position: 'absolute',
                  top: -30,
                  right: -20,
                  width: 100,
                  height: 100,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.1)',
                }} />
                <div style={{
                  position: 'absolute',
                  bottom: -36,
                  right: 48,
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.06)',
                }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
                  <span style={{
                    backgroundColor: 'rgba(255,255,255,0.22)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 8px',
                    borderRadius: 10,
                    lineHeight: '18px',
                    letterSpacing: '0.3px',
                  }}>
                    {grade.grade}级客户
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KeyAccountStar
                      isKeyAccount={customer.isKeyAccount || false}
                      customerId={customer.id}
                      color="rgba(255,255,255,0.9)"
                      mutedColor="rgba(255,255,255,0.4)"
                      onToggle={() => {
                        setList((prev) =>
                          prev.map((c) =>
                            c.id === customer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                          )
                        );
                      }}
                    />
                    <span style={{ fontSize: 20, lineHeight: 1, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.1))' }}>{getCountryFlag(customer.country)}</span>
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginTop: 12, lineHeight: 1.3, position: 'relative', zIndex: 1 }}>
                  {customer.companyName || '-'}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginTop: 4, position: 'relative', zIndex: 1 }}>
                  {findCountry(customer.country)?.zh || (customer.country || '未知')}
                </div>
              </div>

              {/* 白色内容区 */}
              <div style={{ padding: '14px 20px', backgroundColor: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar size={40} style={{ backgroundColor: bgColor, fontSize: 15, fontWeight: 700 }}>
                      {firstChar}
                    </Avatar>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a2e' }}>{customer.contactName || '-'}</div>
                      <div style={{ fontSize: 11, color: '#999' }}>{customer.email || customer.phone || '-'}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#999' }}>合同额</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e' }}>
                      {formatCurrency(customer.totalAmount || 0)}
                    </div>
                    <div style={{ fontSize: 11, color: '#999' }}>{customer._count?.orders ?? 0} 单</div>
                  </div>
                </div>
              </div>

              {/* 标签 + 创建时间 */}
              <div style={{ padding: '0 20px 14px', backgroundColor: '#fff', borderRadius: '0 0 16px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, flex: 1, minWidth: 0 }}>
                  {tagsToArray(customer.tags).map((tag) => (
                    <Tag key={tag.name} color={tag.color} style={{
                      margin: 0,
                      borderRadius: 10,
                      fontSize: 11,
                      padding: '1px 8px',
                    }}>{tag.name}</Tag>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#bbb', whiteSpace: 'nowrap', marginLeft: 8 }}>
                  {dayjs(customer.createdAt).format('YYYY-MM-DD')}
                </div>
              </div>
            </Card>
          </Col>
        );
      })}
    </Row>
  );

  // ========== 渲染列表视图 ==========
  const renderListView = () => {
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
              <div style={{ fontWeight: 600, color: '#1a1a2e' }}>{customer.companyName}</div>
              <div style={{ fontSize: 12, color: '#999' }}>{customer.contactName || '暂无联系人'}</div>
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
                backgroundColor: g.bg,
                color: g.color,
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
        title: '负责人',
        key: 'owner',
        render: (_: any, customer: Customer) =>
          customer.owner?.realName || customer.owner?.username || <Tag>公海</Tag>,
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
              style={{ color: '#999', fontSize: 13 }}
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
        style={{ backgroundColor: '#fff', borderRadius: 16 }}
      />
    );
  };

  // ========== 分页器 ==========
  const renderPagination = () => {
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
  };

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* 统计卡片 */}
      {renderStats()}

      {/* 工具栏 */}
      {renderToolbar()}

      {/* 内容区 */}
      <Spin spinning={loading}>
        {viewMode === 'card' ? renderCardView() : renderListView()}
        {list.length === 0 && !loading && (
          <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
            <div>暂无客户数据</div>
          </div>
        )}
      </Spin>

      {/* 分页 */}
      {renderPagination()}

      {/* ===== 创建/编辑弹窗 ===== */}
      <Modal
        title={editingCustomer ? '编辑客户' : '新增客户'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => setModalOpen(false)}
        width={640}
        zIndex={2000}
        forceRender
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="companyName" label="公司名称" rules={[{ required: true }]}>
            <Input placeholder="公司名称" />
          </Form.Item>
          <Form.Item name="contactName" label="联系人">
            <Input placeholder="联系人" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="邮箱" />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input placeholder="电话" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="country" label="国家">
                <CountrySelect />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="source" label="来源">
                <Select placeholder="来源" allowClear>
                  <Select.Option value="MANUAL">手动录入</Select.Option>
                  <Select.Option value="EXCEL">Excel导入</Select.Option>
                  <Select.Option value="XIAOMAN">小满API</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="isKeyAccount" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.isKeyAccount !== cur.isKeyAccount}
          >
            {({ getFieldValue, setFieldsValue }) => (
              <Form.Item label="重点客户">
                <KeyAccountStar
                  isKeyAccount={getFieldValue('isKeyAccount') || false}
                  customerId={editingCustomer?.id}
                  onToggle={() => setFieldsValue({ isKeyAccount: !getFieldValue('isKeyAccount') })}
                />
              </Form.Item>
            )}
          </Form.Item>
          <Form.Item name="intentLevel" label="采购意向">
            <Select placeholder="选择采购意向">
              {INTENT_OPTIONS.map((o) => (
                <Select.Option key={o.value} value={o.value}>
                  <Tag color={o.color}>{o.label}</Tag>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="tags" label="标签">
            <TagColorEditor />
          </Form.Item>
          <Form.Item name="firstOrderDate" label="首次订单日期">
            <Input type="date" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注信息" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ===== 转交弹窗 ===== */}
      <Modal
        title="转交客户"
        open={transferModalOpen}
        onCancel={() => setTransferModalOpen(false)}
        onOk={handleTransfer}
        okText="确认转交"
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary">选择目标业务员</Text>
        </div>
        <Select
          showSearch
          placeholder="搜索并选择业务员"
          style={{ width: '100%' }}
          value={transferTargetId || undefined}
          onChange={(v) => setTransferTargetId(v)}
          filterOption={(input, option: any) =>
            option?.label?.toLowerCase().includes(input.toLowerCase())
          }
          options={userList
            .filter((u: User) => u.id !== detailCustomer?.ownerId && u.status === 'ACTIVE')
            .map((u: User) => ({
              value: u.id,
              label: `${u.realName || u.username}`,
            }))}
        />
      </Modal>

      {/* ===== 详情抽屉 ===== */}
      <Drawer
        title={
          detailCustomer ? (
            <Space>
              {detailCustomer.owner ? (
                <Popover content={`负责人：${detailCustomer.owner.realName || detailCustomer.owner.username}`}>
                  <Avatar size="small" style={{ backgroundColor: '#1677ff', cursor: 'default' }}>
                    {(detailCustomer.owner.realName || detailCustomer.owner.username)?.[0]}
                  </Avatar>
                </Popover>
              ) : (
                <Tag color="default">公海</Tag>
              )}
              <span>{detailCustomer.companyName}</span>
            </Space>
          ) : '客户详情'
        }
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={680}
        styles={{ wrapper: { borderRadius: '10px 0 0 10px', overflow: 'hidden' } }}
        loading={detailLoading}
        extra={
          detailCustomer && (
            <Space>
              {drawerEditing ? (
                <>
                  <Button onClick={() => { setDrawerEditing(false); }}>取消</Button>
                  <Button type="primary" loading={drawerSaving} onClick={handleDrawerSave}>保存</Button>
                </>
              ) : (
                <>
                  <Button onClick={() => { openCreateOrder(detailCustomer.id); }}>
                    <ShoppingCartOutlined /> 下订单
                  </Button>
                  {detailCustomer.ownerId ? (
                    <>
                      <Button icon={<SwapOutlined />} onClick={() => openTransfer(detailCustomer.id)}>转交</Button>
                      <Button type="primary" onClick={enterDrawerEdit}>编辑</Button>
                      <Popconfirm
                        title="确认释放到公海？"
                        onConfirm={() => handleRelease(detailCustomer.id)}
                      >
                        <Button>释放</Button>
                      </Popconfirm>
                      <Popconfirm
                        title="确认删除？"
                        onConfirm={() => handleDelete(detailCustomer.id)}
                      >
                        <Button danger>删除</Button>
                      </Popconfirm>
                    </>
                  ) : (
                    <Button type="primary" icon={<UserAddOutlined />} onClick={() => handleClaim(detailCustomer.id)}>
                      认领
                    </Button>
                  )}
                </>
              )}
            </Space>
          )
        }
      >
        {detailCustomer && (
          <div>
            {/* 基本信息 */}
            <Card size="small" title="基本信息" style={{ marginBottom: 16, borderRadius: 8 }}>
              {drawerEditing ? (
                <Row gutter={[16, 12]}>
                  <Col span={12}>
                    <Text type="secondary">公司名称</Text>
                    <Input
                      value={drawerEditValues.companyName}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, companyName: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">联系人</Text>
                    <Input
                      value={drawerEditValues.contactName}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, contactName: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">邮箱</Text>
                    <Input
                      value={drawerEditValues.email}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, email: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">电话</Text>
                    <Input
                      value={drawerEditValues.phone}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, phone: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">国家</Text>
                    <CountrySelect
                      value={drawerEditValues.country}
                      onChange={(val) => setDrawerEditValues({ ...drawerEditValues, country: val })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">来源</Text>
                    <Select
                      value={drawerEditValues.source || undefined}
                      onChange={(val) => setDrawerEditValues({ ...drawerEditValues, source: val })}
                      placeholder="来源"
                      allowClear
                      style={{ marginTop: 4, width: '100%' }}
                    >
                      <Select.Option value="MANUAL">手动录入</Select.Option>
                      <Select.Option value="EXCEL">Excel导入</Select.Option>
                      <Select.Option value="XIAOMAN">小满API</Select.Option>
                    </Select>
                  </Col>
                  <Col span={24}>
                    <Text type="secondary">客户等级</Text>
                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 8 }}>（根据重点客户+采购意向自动推算）</Text>
                    <br />
                    {(() => {
                      const grade = getGrade({
                        ...detailCustomer,
                        isKeyAccount: drawerEditValues.isKeyAccount ?? false,
                        intentLevel: drawerEditValues.intentLevel,
                      } as Customer);
                      return (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 12,
                          backgroundColor: grade.bg,
                          color: grade.color,
                          fontSize: 12,
                          fontWeight: 600,
                          marginTop: 4,
                        }}>
                          {grade.grade}级
                        </span>
                      );
                    })()}
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">重点客户</Text>
                    <div style={{ marginTop: 4 }}>
                      <KeyAccountStar
                        isKeyAccount={drawerEditValues.isKeyAccount || false}
                        customerId={detailCustomer?.id}
                        onToggle={() => setDrawerEditValues({ ...drawerEditValues, isKeyAccount: !drawerEditValues.isKeyAccount })}
                      />
                    </div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">采购意向</Text>
                    <Select
                      value={drawerEditValues.intentLevel || undefined}
                      onChange={(val) => setDrawerEditValues({ ...drawerEditValues, intentLevel: val })}
                      placeholder="选择采购意向"
                      allowClear
                      style={{ marginTop: 4, width: '100%' }}
                    >
                      {INTENT_OPTIONS.map((o) => (
                        <Select.Option key={o.value} value={o.value}>
                          <Tag color={o.color}>{o.label}</Tag>
                        </Select.Option>
                      ))}
                    </Select>
                  </Col>
                  <Col span={24}>
                    <Text type="secondary">标签</Text>
                    <div style={{ marginTop: 4 }}>
                      <TagColorEditor
                        value={drawerEditValues.tags}
                        onChange={(tags) => setDrawerEditValues({ ...drawerEditValues, tags })}
                      />
                    </div>
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">首次订单日期</Text>
                    <Input
                      type="date"
                      value={drawerEditValues.firstOrderDate || ''}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, firstOrderDate: e.target.value })}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                  <Col span={24}>
                    <Text type="secondary">备注</Text>
                    <Input.TextArea
                      value={drawerEditValues.notes}
                      onChange={(e) => setDrawerEditValues({ ...drawerEditValues, notes: e.target.value })}
                      rows={2}
                      style={{ marginTop: 4 }}
                    />
                  </Col>
                </Row>
              ) : (
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
                  <Col span={12}><Text type="secondary">国家</Text><br /><CountryDisplay country={detailCustomer.country} /></Col>
                  <Col span={12}><Text type="secondary">来源</Text><br /><Text>{detailCustomer.source || '-'}</Text></Col>
                  <Col span={24}>
                    <Text type="secondary">客户等级</Text><br />
                    {(() => {
                      const grade = getGrade(detailCustomer);
                      return (
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 10px',
                          borderRadius: 12,
                          backgroundColor: grade.bg,
                          color: grade.color,
                          fontSize: 12,
                          fontWeight: 600,
                        }}>
                          {grade.grade}级
                        </span>
                      );
                    })()}
                  </Col>
                  <Col span={12}>
                    <Text type="secondary">重点客户</Text><br />
                    <KeyAccountStar
                      isKeyAccount={detailCustomer.isKeyAccount || false}
                      customerId={detailCustomer.id}
                      onToggle={() => {
                        setList((prev) =>
                          prev.map((c) =>
                            c.id === detailCustomer.id ? { ...c, isKeyAccount: !c.isKeyAccount } : c
                          )
                        );
                        setDetailCustomer({ ...detailCustomer, isKeyAccount: !detailCustomer.isKeyAccount });
                      }}
                    />
                  </Col>
                  {detailCustomer.firstOrderDate && (
                    <Col span={12}><Text type="secondary">首次下单</Text><br /><Text>{detailCustomer.firstOrderDate}</Text></Col>
                  )}
                  {detailCustomer.tags && (
                    <Col span={24}>
                      <Text type="secondary">标签</Text><br />
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                        {tagsToArray(detailCustomer.tags).map((tag) => (
                          <Tag key={tag.name} color={tag.color} style={{ borderRadius: 10, margin: 0 }}>
                            {tag.name}
                          </Tag>
                        ))}
                      </div>
                    </Col>
                  )}
                  {detailCustomer.notes && (
                    <Col span={24}><Text type="secondary">备注</Text><br /><Text>{detailCustomer.notes}</Text></Col>
                  )}
                </Row>
              )}
            </Card>

            {/* 订单列表 */}
            <Card
              size="small"
              title={<span><ShoppingCartOutlined /> 订单记录 ({customerOrders.length})</span>}
              style={{ marginBottom: 16, borderRadius: 8 }}
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
                      <th style={{ textAlign: 'right', padding: 8 }}>金额</th>
                      <th style={{ textAlign: 'center', padding: 8 }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerOrders.map((o) => (
                      <tr key={o.id} style={{ borderBottom: '1px solid #fafafa' }}>
                        <td style={{ padding: 8 }}>{o.orderNo || '-'}</td>
                        <td style={{ padding: 8 }}>{o.orderDate || '-'}</td>
                        <td style={{ padding: 8, textAlign: 'right', fontWeight: 500 }}>
                          {formatCurrency(o.amountCNY ?? 0)}
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
            <Card size="small" title="活动记录" style={{ borderRadius: 8 }}>
              {detailCustomer.activities?.length === 0 ? (
                <Text type="secondary">暂无记录</Text>
              ) : (
                <div>
                  {(detailCustomer.activities || [])
                    .slice(0, showAllActivities ? undefined : 5)
                    .map((a: CustomerActivity) => (
                      <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #fafafa', display: 'flex', gap: 12 }}>
                        <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 90 }}>
                          {dayjs(a.createdAt).format('MM-DD HH:mm')}
                        </Text>
                        <Text style={{ fontSize: 13 }}>{a.detail || a.action}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>{a.createdBy}</Text>
                      </div>
                    ))}
                  {(detailCustomer.activities || []).length > 5 && (
                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setShowAllActivities(!showAllActivities)}
                      >
                        {showAllActivities
                          ? '收起'
                          : `展开全部 (${detailCustomer.activities?.length} 条)`}
                      </Button>
                    </div>
                  )}
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
        zIndex={2000}
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
        zIndex={2000}
        forceRender
      >
        <Form form={orderForm} layout="vertical" style={{ marginTop: 12 }}>
          <Space style={{ width: '100%' }} size={16}>
            <Form.Item name="orderNo" label="订单号" style={{ width: 170 }}>
              <Input placeholder="订单号" />
            </Form.Item>
            <Form.Item name="orderDate" label="订单日期" style={{ width: 170 }}>
              <Input type="date" />
            </Form.Item>
            <Form.Item name="amountCNY" label="金额（CNY）" style={{ width: 170 }}>
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
