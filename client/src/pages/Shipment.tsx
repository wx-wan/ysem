import { Card, Typography, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

const { Title } = Typography;

export default function ShipmentPage() {
  const { t } = useTranslation();

  return (
    <div>
      <Title level={3} style={{ marginBottom: 16 }}>{t('menu.shipment')}</Title>
      <Card style={{ borderRadius: 12 }}>
        <Empty description={t('common.noData')} />
      </Card>
    </div>
  );
}
