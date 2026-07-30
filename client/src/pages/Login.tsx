import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../api/auth';
import { useAuthStore } from '../stores/useAuthStore';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await authApi.login(values);
      const { user, accessToken, refreshToken } = res.data.data;
      setAuth(user, accessToken, refreshToken);
      message.success('登录成功');
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
        <h1>义乌寿春企业管理系统</h1>
        <p className="subtitle">Yiwu Shouchun Enterprise</p>
        <Form
          name="login"
          size="large"
          onFinish={onFinish}
          initialValues={{ username: 'admin', password: 'admin123' }}
        >
          <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input prefix={<UserOutlined />} placeholder="用户名" />
          </Form.Item>
          <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登 录
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  );
}
