import React, { useEffect, useState } from 'react';
import { Button, Tag, Space, Typography } from 'antd';
import { CheckCircleFilled, PlusOutlined, UserAddOutlined, AppstoreAddOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import AppModal from '../AppModal';

const { Text } = Typography;

export interface ConvertSummaryItems {
  /** 待建档客户名称（缺客户时传入） */
  customerName?: string;
  /** 待建档产品名称（缺产品时传入） */
  productName?: string;
}

interface Props {
  open: boolean;
  items: ConvertSummaryItems;
  /** 点击「新建客户」：由父级打开真实新建客户弹窗并 resolve 出新 id */
  onOpenCustomer: (initial?: {
    companyName?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    country?: string;
  }) => Promise<{ id: string }>;
  /** 点击「新建产品」：由父级打开真实新建产品弹窗并 resolve 出新 id */
  onOpenProduct: (initial?: { name?: string; description?: string }) => Promise<{ id: string }>;
  /** 全部建档完成后确认转商机 */
  onConfirm: (ids: { customerId?: string; productId?: string }) => void;
  /** 取消（中止转商机） */
  onCancel: () => void;
}

const Row: React.FC<{
  icon: React.ReactNode;
  label: string;
  name: string;
  built: boolean;
  loading: boolean;
  onBuild: () => void;
}> = ({ icon, label, name, built, loading, onBuild }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 14px',
      border: '1px solid #f0f0f0',
      borderRadius: 8,
      marginBottom: 10,
      background: built ? '#f6ffed' : '#fff',
    }}
  >
    <span style={{ fontSize: 18, color: '#1677ff' }}>{icon}</span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <Text type="secondary" ellipsis style={{ display: 'block', maxWidth: 320 }}>
        {name || '-'}
      </Text>
    </div>
    {built ? (
      <Tag color="success" icon={<CheckCircleFilled />}>
        已建档
      </Tag>
    ) : (
      <Button type="primary" ghost size="small" icon={<PlusOutlined />} loading={loading} onClick={onBuild}>
        新建
      </Button>
    )}
  </div>
);

const ConvertCreateSummaryModal: React.FC<Props> = ({
  open,
  items,
  onOpenCustomer,
  onOpenProduct,
  onConfirm,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [builtCustomerId, setBuiltCustomerId] = useState<string | undefined>();
  const [builtProductId, setBuiltProductId] = useState<string | undefined>();
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);

  // 每次打开重置
  useEffect(() => {
    if (open) {
      setBuiltCustomerId(undefined);
      setBuiltProductId(undefined);
      setLoadingCustomer(false);
      setLoadingProduct(false);
    }
  }, [open]);

  const needCustomer = !!items.customerName;
  const needProduct = !!items.productName;
  const customerOk = !needCustomer || !!builtCustomerId;
  const productOk = !needProduct || !!builtProductId;
  const allReady = customerOk && productOk;

  const handleBuildCustomer = async () => {
    setLoadingCustomer(true);
    try {
      const r = await onOpenCustomer({ companyName: items.customerName });
      if (r?.id) setBuiltCustomerId(r.id);
    } finally {
      setLoadingCustomer(false);
    }
  };

  const handleBuildProduct = async () => {
    setLoadingProduct(true);
    try {
      const r = await onOpenProduct({ name: items.productName });
      if (r?.id) setBuiltProductId(r.id);
    } finally {
      setLoadingProduct(false);
    }
  };

  return (
    <AppModal
      open={open}
      title={t('lead.createSummaryTitle')}
      onClose={onCancel}
      maskClosable={false}
      closable={false}
      footer={
        <Space>
          <Button key="cancel" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            key="ok"
            type="primary"
            disabled={!allReady}
            onClick={() => onConfirm({ customerId: builtCustomerId, productId: builtProductId })}
          >
            {t('lead.createSummaryConfirm')}
          </Button>
        </Space>
      }
      bodyPadding={20}
    >
      <p style={{ color: 'rgba(0,0,0,0.45)', marginBottom: 16 }}>
        {t('lead.createSummaryDesc')}
      </p>
      {needCustomer && (
        <Row
          icon={<UserAddOutlined />}
          label={t('lead.createCustomerConfirmTitle')}
          name={items.customerName || ''}
          built={!!builtCustomerId}
          loading={loadingCustomer}
          onBuild={handleBuildCustomer}
        />
      )}
      {needProduct && (
        <Row
          icon={<AppstoreAddOutlined />}
          label={t('lead.createProductConfirmTitle')}
          name={items.productName || ''}
          built={!!builtProductId}
          loading={loadingProduct}
          onBuild={handleBuildProduct}
        />
      )}
      {!allReady && (
        <Space size={4} style={{ color: '#faad14', fontSize: 12 }}>
          {!customerOk && <span>· {t('lead.createSummaryCustomerPending')}</span>}
          {!productOk && <span>· {t('lead.createSummaryProductPending')}</span>}
        </Space>
      )}
    </AppModal>
  );
};

export default ConvertCreateSummaryModal;
