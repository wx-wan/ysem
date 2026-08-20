import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export default function ForbiddenPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <Result
        status="403"
        title="403"
        subTitle={t('error.forbidden')}
        extra={<Button type="primary" onClick={() => navigate('/')}>{t('common.backHome')}</Button>}
      />
    </div>
  );
}
