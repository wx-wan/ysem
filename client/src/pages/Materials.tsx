import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function MaterialsPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.materials')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
