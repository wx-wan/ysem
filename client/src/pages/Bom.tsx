import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function BomPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.bom')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
