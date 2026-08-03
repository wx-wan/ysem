import React from 'react';
import { Modal, Row, Col, Tag, Typography } from 'antd';
import { Order } from '../../api/customers';
import Price from '../common/Price';

const { Text } = Typography;

const STATUS_OPTIONS: Record<string, { label: string; color: string }> = {
  PENDING: { label: '待确认', color: 'default' },
  CONFIRMED: { label: '已确认', color: 'processing' },
  IN_PRODUCTION: { label: '生产中', color: 'orange' },
  SHIPPED: { label: '已发货', color: 'cyan' },
  DELIVERED: { label: '已交付', color: 'green' },
};

interface Props {
  open: boolean;
  detailOrder: Order | null;
  onClose: () => void;
}

const OrderDetailModal: React.FC<Props> = React.memo(({ open, detailOrder, onClose }) => {
  if (!detailOrder) return null;

  return (
    <Modal
      title="订单详情"
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      zIndex={2000}
    >
      <div>
        <Row gutter={[16, 12]}>
          <Col span={12}><Text type="secondary">订单号</Text><br /><Text strong>{detailOrder.orderNo || '-'}</Text></Col>
          <Col span={12}><Text type="secondary">客户</Text><br /><Text>{detailOrder.customer?.companyName || '-'}</Text></Col>
          <Col span={12}><Text type="secondary">订单日期</Text><br /><Text>{detailOrder.orderDate || '-'}</Text></Col>
          <Col span={12}><Text type="secondary">金额</Text><br /><Text strong style={{ fontSize: 16 }}><Price value={detailOrder.amountCNY ?? 0} /></Text></Col>
          <Col span={12}><Text type="secondary">交付日期</Text><br /><Text>{detailOrder.deliveryDate || '-'}</Text></Col>
          <Col span={12}><Text type="secondary">付款条件</Text><br /><Text>{detailOrder.paymentTerms || '-'}</Text></Col>
          <Col span={12}>
            <Text type="secondary">状态</Text><br />
            <Tag color={STATUS_OPTIONS[detailOrder.status || '']?.color || 'default'}>
              {STATUS_OPTIONS[detailOrder.status || '']?.label || detailOrder.status || '-'}
            </Tag>
          </Col>
          <Col span={12}><Text type="secondary">联系人</Text><br /><Text>{detailOrder.customer?.contactName || '-'}</Text></Col>
          {detailOrder.notes && (
            <Col span={24}><Text type="secondary">备注</Text><br /><Text>{detailOrder.notes}</Text></Col>
          )}
        </Row>
      </div>
    </Modal>
  );
});

export default OrderDetailModal;
