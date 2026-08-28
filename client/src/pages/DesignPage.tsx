import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function DesignPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.design')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
