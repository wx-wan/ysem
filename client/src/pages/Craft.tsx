import { Card, Empty } from 'antd';
import { useTranslation } from 'react-i18next';

export default function CraftPage() {
  const { t } = useTranslation();
  return (
    <Card title={t('menu.craft')} variant="borderless">
      <Empty description={t('common.inDevelopment')} />
    </Card>
  );
}
