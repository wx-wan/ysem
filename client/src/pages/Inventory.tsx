import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function InventoryPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.inventory')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
