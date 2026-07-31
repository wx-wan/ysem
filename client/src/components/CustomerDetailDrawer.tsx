import React, { useState, useCallback } from 'react';
import {
  Drawer, Space, Avatar, Tag, Button, Popconfirm, Typography,
  Row, Col, Card, Descriptions, Table, Select, Input,
  Spin, Tooltip, message,
} from 'antd';
import {
  SwapOutlined, UserAddOutlined, ShoppingCartOutlined,
  GlobalOutlined, MailOutlined, PhoneOutlined, EnvironmentOutlined,
  UserOutlined, CalendarOutlined, FileTextOutlined,
  EditOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import CountryDisplay from './CountryDisplay';
import CountrySelect from './CountrySelect';
import FlagIcon from './FlagIcon';
import KeyAccountStar from './KeyAccountStar';
import TagSelector from './TagSelector';
import { findCountry } from '../data/countries';
import { getGrade, tagColorToHex, tagColorToBg, getCustomerTypeLabel, avatarColor } from './customer/utils';
import { formatCurrency as formatCur } from '../stores/useCurrencyStore';
import { customerApi } from '../api/customers';
import type { Customer, Order, CustomerActivity, User } from '../types';

const { Text } = Typography;

// 采购意向配置
const INTENT_OPTIONS = [
  { value: 'LOW', label: '低意向', tagColor: 'default' as const },
  { value: 'MEDIUM', label: '中意向', tagColor: 'warning' as const },
  { value: 'HIGH', label: '高意向', tagColor: 'orange' as const },
  { value: 'READY', label: '准成交', tagColor: 'red' as const },
];

const INTENT_MAP: Record<string, { label: string; tagColor: string }> = {};
INTENT_OPTIONS.forEach((o) => (INTENT_MAP[o.value] = o));

interface CustomerDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  customer: Customer | null;
  orders: Order[];
  user: any;
  onRefresh: () => void;
  onCustomerUpdated: (customer: Customer) => void;
  onCustomerDeleted: () => void;
  onTransfer: (customerId: string) => void;
  openCreateOrder: (customerId: string) => void;
  onOrderUpdated: (customer: Customer) => void;
}

const CustomerDetailDrawer = React.memo(function CustomerDetailDrawer({
  open,
  onClose,
  loading,
  customer,
  orders,
  user,
  onRefresh,
  onCustomerUpdated,
  onCustomerDeleted,
  onTransfer,
  openCreateOrder,
  onOrderUpdated,
}: CustomerDetailDrawerProps) {
  // 内部状态
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [showAllActivities, setShowAllActivities] = useState(false);

  const isAdmin = user?.role?.code === 'admin';
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
      intentLevel: customer.intentLevel || undefined,
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
      const updated = await customerApi.update(customer.id, editValues as any);
      message.success('保存成功');
      onCustomerUpdated({ ...customer, ...editValues });
      setEditing(false);
    } catch {
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  }, [customer, editValues, onCustomerUpdated]);

  // 认领
  const handleClaim = useCallback(async () => {
    if (!customer) return;
    await customerApi.claim(customer.id);
    message.success('认领成功');
    onClose();
    onRefresh();
  }, [customer, onClose, onRefresh]);

  // 释放
  const handleRelease = useCallback(async () => {
    if (!customer) return;
    await customerApi.release(customer.id);
    message.success('已释放到公海');
    onClose();
    onRefresh();
  }, [customer, onClose, onRefresh]);

  // 删除
  const handleDelete = useCallback(async () => {
    if (!customer) return;
    await customerApi.remove(customer.id);
    message.success('已删除');
    onClose();
    onCustomerDeleted();
  }, [customer, onClose, onCustomerDeleted]);

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

  // 使用 token（从 antd theme 获取颜色）
  // 这里需要一个 token 源 — 从父组件传入或使用静态 fallback
  const grade = getGrade(customer);

  return (
    <Drawer
      title={
        <Space>
          {customer.owner ? (
            <Popover content={`负责人：${customer.owner.realName || customer.owner.username}`}>
              <Avatar size="small" style={{ backgroundColor: '#1677ff', cursor: 'default' }}>
                {(customer.owner.realName || customer.owner.username)?.[0]}
              </Avatar>
            </Popover>
          ) : (
            <Tag color="default" bordered={false}>公海</Tag>
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
              {customer.ownerId ? (
                canOperate ? (
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
                )
              ) : (
                <Button type="primary" icon={<UserAddOutlined />} onClick={handleClaim}>
                  认领
                </Button>
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
                <Col span={12}>
                  <Text type="secondary">采购意向</Text>
                  <Select
                    value={editValues.intentLevel || undefined}
                    onChange={(val) => setEditValues({ ...editValues, intentLevel: val })}
                    placeholder="选择采购意向"
                    allowClear
                    style={{ marginTop: 4, width: '100%' }}
                  >
                    {INTENT_OPTIONS.map((opt) => (
                      <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                    ))}
                  </Select>
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
              extra={<Button size="small" icon={<EditOutlined />} onClick={enterEdit}>编辑</Button>}
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
              {/* 等级 & 意向 & 标签 */}
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <Text type="secondary" style={{ minWidth: 50 }}>等级：</Text>
                <Tag color={grade.tagColor} bordered={false}>{grade.grade}级</Tag>
                {(() => {
                  const tl = getCustomerTypeLabel(customer);
                  if (tl) return <Tag bordered={false} color={tl.color}>{tl.label}</Tag>;
                  return null;
                })()}
                {INTENT_MAP[customer.intentLevel || ''] && (
                  <Tag bordered={false} color={INTENT_MAP[customer.intentLevel!].tagColor}>
                    意向: {INTENT_MAP[customer.intentLevel!].label}
                  </Tag>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text type="secondary">重点客户</Text>
                  <KeyAccountStar
                    isKeyAccount={customer.isKeyAccount || false}
                    customerId={customer.id}
                    onToggle={() => onRefresh()}
                  />
                </div>
              </div>
              {/* 标签列表 */}
              {customer.tags && (
                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {customer.tags.split(',').filter(Boolean).map((tagStr: string) => {
                    const idx = tagStr.lastIndexOf('#');
                    const name = idx > 0 ? tagStr.slice(0, idx) : tagStr;
                    const color = idx > 0 ? tagStr.slice(idx + 1) : undefined;
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

          {/* ===== 订单记录 ===== */}
          <Card
            size="small"
            title={<span><ShoppingCartOutlined /> 订单记录 ({orders.length})</span>}
            style={{ marginBottom: 16, borderRadius: 8 }}
            extra={
              canOperate ? (
                <Button size="small" type="primary" onClick={() => openCreateOrder(customer.id)}>
                  <ShoppingCartOutlined /> 下订单
                </Button>
              ) : customer.ownerId ? (
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
    </Drawer>
  );
});

export default CustomerDetailDrawer;
