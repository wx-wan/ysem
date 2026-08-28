import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function SuppliersPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.suppliers')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
