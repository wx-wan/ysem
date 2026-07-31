import React, { useState, useCallback, useEffect } from 'react';
import {
  Drawer, Space, Avatar, Tag, Button, Popconfirm, Popover, Typography,
  Row, Col, Card, Descriptions, Table, Input, InputNumber,
  Spin, theme, Modal, App, Select,
} from 'antd';
import {
  SwapOutlined, UserAddOutlined, ShoppingCartOutlined,
  GlobalOutlined, MailOutlined, PhoneOutlined, EnvironmentOutlined,
  UserOutlined, CalendarOutlined, FileTextOutlined,
  ClockCircleOutlined, DollarOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import CountryDisplay from './CountryDisplay';
import CountrySelect from './CountrySelect';
import KeyAccountStar from './KeyAccountStar';
import TagSelector from './TagSelector';
import { getCustomerTypeLabel } from './customer/utils';
import { useCurrencyStore } from '../stores/useCurrencyStore';
import { customerApi } from '../api/customers';
import { salesApi, SalesItem } from '../api/sales';
import type { Customer, Order, CustomerActivity } from '../types';

const { Text } = Typography;

// 采购意向选项（直接存储中文标签）
const INTENT_OPTIONS = [
  { label: '低意向', value: '低意向' },
  { label: '中意向', value: '中意向' },
  { label: '高意向', value: '高意向' },
  { label: '准成交', value: '准成交' },
];

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
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [pipelines, setPipelines] = useState<SalesItem[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const formatCur = useCurrencyStore((state) => state.format);
  const { message } = App.useApp();

  // 商机记录 CRUD 状态
  const [pipelineModalOpen, setPipelineModalOpen] = useState(false);
  const [editingPipeline, setEditingPipeline] = useState<SalesItem | null>(null);
  const [pipelineForm, setPipelineForm] = useState({ name: '', estimatedAmount: undefined as number | undefined, probability: undefined as string | undefined, expectedCloseDate: '' });
  const [pipelineSaving, setPipelineSaving] = useState(false);

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

  const isAdmin = user?.role?.code === 'admin';
  const isPublic = customer ? (!customer.ownerId || customer.owner?.role?.code === 'admin') : true;
  const canOperate = customer ? (isAdmin || customer.ownerId === user?.id) : false;

  // 进入编辑
  const enterEdit = useCallback(() => {
    if (!customer) return;
    setEditValues({
      companyName: customer.companyName || '',
      contactName: customer.contactName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      country: customer.country || '',
      source: customer.source || '',
      isKeyAccount: customer.isKeyAccount || false,
      tags: customer.tags || '',
      notes: customer.notes || '',
    });
    setEditing(true);
  }, [customer]);

  // 保存
  const handleSave = useCallback(async () => {
    if (!customer) return;
    setSaving(true);
    try {
      await customerApi.update(customer.id, editValues as any);
      message.success('保存成功');
      setEditing(false);
      onRefresh(customer.id);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [customer, editValues, onRefresh]);

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
    setEditing(false);
    setShowAllActivities(false);
    onClose();
  }, [onClose]);

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
      title={
        <Space>
              {isPublic ? (
                <Tag color="default" bordered={false}>公海</Tag>
              ) : (
                <Popover content={`负责人：${customer.owner?.realName || customer.owner?.username}`}>
                  <Avatar size="small" style={{ backgroundColor: '#1677ff', cursor: 'default' }}>
                    {(customer.owner?.realName || customer.owner?.username)?.[0]}
                  </Avatar>
                </Popover>
              )}
          <span>{customer.companyName}</span>
        </Space>
      }
      open={open}
      onClose={handleClose}
      width={680}
      styles={{ wrapper: { borderRadius: '10px 0 0 10px', overflow: 'hidden' } }}
      loading={loading}
      extra={
        <Space>
          {editing ? (
            <>
              <Button onClick={() => setEditing(false)}>取消</Button>
              <Button type="primary" loading={saving} onClick={handleSave}>保存</Button>
            </>
          ) : (
            <>
              {isPublic ? (
                <Button type="primary" icon={<UserAddOutlined />} onClick={handleClaim}>
                  认领
                </Button>
              ) : canOperate ? (
                  <>
                    <Button icon={<SwapOutlined />} onClick={() => onTransfer(customer.id)}>转交</Button>
                    <Button type="primary" onClick={enterEdit}>编辑</Button>
                    <Popconfirm title="确认释放到公海？" onConfirm={handleRelease}>
                      <Button>释放</Button>
                    </Popconfirm>
                    <Popconfirm title="确认删除？" onConfirm={handleDelete}>
                      <Button danger>删除</Button>
                    </Popconfirm>
                  </>
                ) : (
                  <Tag color="warning" bordered={false}>无操作权限</Tag>
                )}
            </>
          )}
        </Space>
      }
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
        </div>
      ) : (
        <div>
          {/* ===== 基本信息卡片 ===== */}
          {editing ? (
            <Card size="small" title="编辑客户信息" style={{ marginBottom: 16, borderRadius: 8 }}>
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <Text type="secondary">公司名称</Text>
                  <Input
                    value={editValues.companyName}
                    onChange={(e) => setEditValues({ ...editValues, companyName: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">联系人</Text>
                  <Input
                    value={editValues.contactName}
                    onChange={(e) => setEditValues({ ...editValues, contactName: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">邮箱</Text>
                  <Input
                    value={editValues.email}
                    onChange={(e) => setEditValues({ ...editValues, email: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">电话</Text>
                  <Input
                    value={editValues.phone}
                    onChange={(e) => setEditValues({ ...editValues, phone: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">国家</Text>
                  <CountrySelect
                    value={editValues.country}
                    onChange={(v) => setEditValues({ ...editValues, country: v })}
                    style={{ marginTop: 4, width: '100%' }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">来源</Text>
                  <Input
                    value={editValues.source}
                    onChange={(e) => setEditValues({ ...editValues, source: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">标签</Text>
                  <TagSelector
                    value={editValues.tags}
                    onChange={(v: string) => setEditValues({ ...editValues, tags: v })}
                    placeholder="输入标签"
                  />
                </Col>
                <Col span={12}>
                  <Text type="secondary">重点客户</Text>
                  <div style={{ marginTop: 4 }}>
                    <KeyAccountStar
                      isKeyAccount={editValues.isKeyAccount || false}
                      customerId={customer?.id}
                      onToggle={() => setEditValues({ ...editValues, isKeyAccount: !editValues.isKeyAccount })}
                    />
                  </div>
                </Col>
                <Col span={24}>
                  <Text type="secondary">备注</Text>
                  <Input.TextArea
                    rows={2}
                    value={editValues.notes}
                    onChange={(e) => setEditValues({ ...editValues, notes: e.target.value })}
                    style={{ marginTop: 4 }}
                  />
                </Col>
              </Row>
            </Card>
          ) : (
            <Card
              size="small"
              title={<span><UserOutlined /> 基本信息</span>}
              style={{ marginBottom: 16, borderRadius: 8 }}
            >
              <Descriptions column={2} size="small" colon={false}>
                <Descriptions.Item label={<><EnvironmentOutlined /> 国家</>}>
                  <CountryDisplay country={customer.country} />
                </Descriptions.Item>
                <Descriptions.Item label={<><GlobalOutlined /> 来源</>}>
                  {customer.source || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<><UserOutlined /> 联系人</>}>
                  {customer.contactName || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<><PhoneOutlined /> 电话</>}>
                  {customer.phone || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<><MailOutlined /> 邮箱</>}>
                  {customer.email || '-'}
                </Descriptions.Item>
                <Descriptions.Item label={<><CalendarOutlined /> 创建时间</>}>
                  {dayjs(customer.createdAt).format('YYYY-MM-DD')}
                </Descriptions.Item>
              </Descriptions>
              {/* 标签 */}
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                {(() => {
                  const tl = getCustomerTypeLabel(customer);
                  if (tl) return <Tag bordered={false} color={tl.color}>{tl.label}</Tag>;
                  return null;
                })()}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text type="secondary">重点客户</Text>
                  <KeyAccountStar
                    isKeyAccount={customer.isKeyAccount || false}
                    customerId={customer.id}
                    onToggle={() => onRefresh(customer.id)}
                  />
                </div>
              </div>
              {/* 标签列表：只展示自定义标签，过滤系统标签 */}
              {customer.tags && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {customer.tags.split(',').filter(Boolean).filter((tagStr: string) => {
                    const idx = tagStr.lastIndexOf('#');
                    const name = idx > 0 ? tagStr.slice(0, idx) : tagStr;
                    const SYSTEM_TAGS = ['重点客户', '未成交客户', '本年度新客', '往年老客'];
                    return !SYSTEM_TAGS.includes(name);
                  }).map((tagStr: string) => {
                    const idx = tagStr.lastIndexOf('#');
                    const name = idx > 0 ? tagStr.slice(0, idx) : tagStr;
                    const color = idx > 0 ? `#${tagStr.slice(idx + 1)}` : undefined;
                    return <Tag key={name} bordered={false} color={color}>{name}</Tag>;
                  })}
                </div>
              )}
              {customer.notes && (
                <div style={{ marginTop: 12, padding: '8px 12px', backgroundColor: '#fafafa', borderRadius: 6, fontSize: 13 }}>
                  <Text type="secondary"><FileTextOutlined /> 备注：</Text>{customer.notes}
                </div>
              )}
            </Card>
          )}

          {/* ===== 商机记录 ===== */}
          <Card
            size="small"
            title={<Space><DollarOutlined style={{ color: token.colorWarning }} />商机记录 ({pipelines.length})</Space>}
            extra={!isPublic && canOperate ? <Button type="primary" size="small" icon={<DollarOutlined />} onClick={openCreatePipeline}>新增商机</Button> : null}
            style={{ marginBottom: 16, borderRadius: 8 }}
          >
            {pipelineLoading ? (
              <div style={{ textAlign: 'center', padding: 24 }}>
                <Spin />
              </div>
            ) : pipelines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: token.colorTextQuaternary }}>
                暂无商机记录
              </div>
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
          </Card>

          {/* ===== 订单记录 ===== */}
          <Card
            size="small"
            title={<span><ShoppingCartOutlined /> 订单记录 ({orders.length})</span>}
            style={{ marginBottom: 16, borderRadius: 8 }}
            extra={
              !isPublic && canOperate ? (
                <Button size="small" type="primary" onClick={() => openCreateOrder(customer.id)}>
                  <ShoppingCartOutlined /> 下订单
                </Button>
              ) : !isPublic ? (
                <Tag color="default" bordered={false}>无操作权限</Tag>
              ) : null
            }
          >
            {orders.length === 0 ? (
              <Text type="secondary">暂无订单</Text>
            ) : (
              <Table
                dataSource={orders}
                columns={orderColumns}
                rowKey="id"
                size="small"
                pagination={orders.length > 10 ? { pageSize: 10, size: 'small' } : false}
              />
            )}
          </Card>

          {/* ===== 活动记录 ===== */}
          <Card
            size="small"
            title={<span><ClockCircleOutlined /> 活动记录</span>}
            style={{ borderRadius: 8 }}
          >
            {customer.activities?.length === 0 ? (
              <Text type="secondary">暂无记录</Text>
            ) : (
              <div>
                {(customer.activities || [])
                  .slice(0, showAllActivities ? undefined : 5)
                  .map((a: CustomerActivity) => (
                    <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #f0f0f0', display: 'flex', gap: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 90 }}>
                        {dayjs(a.createdAt).format('MM-DD HH:mm')}
                      </Text>
                      <Text style={{ fontSize: 13 }}>{a.detail || a.action}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{a.createdBy}</Text>
                    </div>
                  ))}
                {(customer.activities || []).length > 5 && (
                  <div style={{ textAlign: 'center', marginTop: 8 }}>
                    <Button type="link" size="small" onClick={() => setShowAllActivities(!showAllActivities)}>
                      {showAllActivities ? '收起' : `展开全部 (${customer.activities?.length} 条)`}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
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
                style={{ width: '100%' }}
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
                style={{ width: '100%' }}
                options={[...INTENT_OPTIONS]}
              />
            </Col>
          </Row>
          <div>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>预计成交日期</Text>
            <Input
              type="date"
              value={pipelineForm.expectedCloseDate}
              onChange={(e) => setPipelineForm({ ...pipelineForm, expectedCloseDate: e.target.value })}
            />
          </div>
        </div>
      </Modal>
    </Drawer>
  );
});

export default CustomerDetailDrawer;
