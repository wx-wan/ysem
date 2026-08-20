import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, App } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/useAuthStore';

export default function LoginPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    document.title = 'Joylifetoy';
    return () => { document.title = 'Joylifetoy'; };
  }, []);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      const { user, accessToken, refreshToken } = res.data.data;
      setAuth(user, accessToken, refreshToken);
      message.success(t('login.success'));
      navigate('/', { replace: true });
    } catch {
      // 错误已在拦截器中处理
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>{t('common.appName')}</h1>
        <p className="subtitle">{t('common.appSubtitle')}</p>
        <Form
          name="login"
          size="large"
          onFinish={onFinish}
          initialValues={{ username: 'admin', password: 'admin123' }}
        >
          <Form.Item name="username" rules={[{ required: true, message: t('login.usernameRequired') }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" placeholder={t('login.usernamePlaceholder')} />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: t('login.passwordRequired') }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" placeholder={t('login.passwordPlaceholder')} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              {t('login.submit')}
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
