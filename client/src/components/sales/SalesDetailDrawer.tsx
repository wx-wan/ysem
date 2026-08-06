import React from 'react';
import { Drawer, Descriptions, Tag, Space, Button, Popconfirm, Select, Card } from 'antd';
import { EditOutlined, DeleteOutlined, RightOutlined } from '@ant-design/icons';
import { SalesItem } from '../../api/sales';
import { getIntentLabel } from './SalesFormModal';
import { SALES_STAGES, STAGE_LABELS } from './stages';
import Price from '../common/Price';

const STAGES = SALES_STAGES;

interface Props {
  open: boolean;
  detailItem: SalesItem | null;
  onClose: () => void;
  onStageChange: (id: string, newStage: string) => void;
  onEdit: (item: SalesItem) => void;
  onDelete: (id: string) => void;
}

const SalesDetailDrawer: React.FC<Props> = React.memo(({ open, detailItem, onClose, onStageChange, onEdit, onDelete }) => {
  if (!detailItem) return null;
  const st = STAGES.find((s) => s.key === detailItem.stage);

  return (
    <Drawer
      title="详情"
      open={open}
      onClose={onClose}
      width={560}
      zIndex={2000}
      extra={
        <Space>
          <Select
            size="small"
            value={detailItem.stage}
            style={{ width: 100 }}
            onChange={(v) => onStageChange(detailItem.id, v)}
            options={STAGES.map((s) => ({ label: s.label, value: s.key }))}
          />
          <Button icon={<EditOutlined />} onClick={() => { onClose(); onEdit(detailItem); }}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => { onDelete(detailItem.id); onClose(); }}>
            <Button danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="标题">{detailItem.title}</Descriptions.Item>
        <Descriptions.Item label="阶段">
          <Tag color={st?.tagColor} bordered={false}>{st?.label || detailItem.stage}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="公司名称">{detailItem.companyName}</Descriptions.Item>
        <Descriptions.Item label="联系人">{detailItem.contactName || '-'}</Descriptions.Item>
        <Descriptions.Item label="邮箱">{detailItem.email || '-'}</Descriptions.Item>
        <Descriptions.Item label="电话">{detailItem.phone || '-'}</Descriptions.Item>
        <Descriptions.Item label="国家">{detailItem.country || '-'}</Descriptions.Item>
        <Descriptions.Item label="来源">{detailItem.source || '-'}</Descriptions.Item>
        <Descriptions.Item label="负责人">{detailItem.assignee?.realName || '未分配'}</Descriptions.Item>
      </Descriptions>

      {detailItem.stage === 'LEAD' && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="感兴趣产品">{detailItem.productInterest || '-'}</Descriptions.Item>
          <Descriptions.Item label="备注">{detailItem.leadNotes || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      {detailItem.stage === 'OPPORTUNITY' && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="预估金额">{detailItem.estimatedAmount ? <Price value={detailItem.estimatedAmount} /> : '-'}</Descriptions.Item>
          <Descriptions.Item label="采购意向">{getIntentLabel(detailItem.probability)}</Descriptions.Item>
          <Descriptions.Item label="预计成交日期">{detailItem.estimatedCloseDate || '-'}</Descriptions.Item>
        </Descriptions>
      )}
      {detailItem.stage === 'ORDER' && (
        <Descriptions column={1} size="small" bordered style={{ marginTop: 16 }}>
          <Descriptions.Item label="订单金额">{detailItem.orderAmount ? <Price value={detailItem.orderAmount} /> : '-'}</Descriptions.Item>
          <Descriptions.Item label="下单日期">{detailItem.orderDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="交付日期">{detailItem.deliveryDate || '-'}</Descriptions.Item>
          <Descriptions.Item label="付款条件">{detailItem.paymentTerms || '-'}</Descriptions.Item>
          <Descriptions.Item label="订单状态">{detailItem.orderStatus || '-'}</Descriptions.Item>
        </Descriptions>
      )}

      {detailItem.activities && detailItem.activities.length > 0 && (
        <Card title="活动记录" size="small" style={{ marginTop: 16 }}>
          {detailItem.activities.map((a) => (
            <div key={a.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
              <Tag color="blue" style={{ marginRight: 8 }}>{a.action}</Tag>
              {a.fromStage && <span>{STAGE_LABELS[a.fromStage]} <RightOutlined /> {STAGE_LABELS[a.toStage || '']}</span>}
              <span style={{ marginLeft: 12, color: '#94a3b8', fontSize: 11 }}>{new Date(a.createdAt).toLocaleString('zh-CN')}</span>
            </div>
          ))}
        </Card>
      )}

      <div style={{ marginTop: 16 }}>
        <span style={{ color: '#94a3b8', fontSize: 12 }}>
          创建于 {new Date(detailItem.createdAt).toLocaleString('zh-CN')} | 更新于 {new Date(detailItem.updatedAt).toLocaleString('zh-CN')}
        </span>
      </div>
    </Drawer>
  );
});

export default SalesDetailDrawer;
