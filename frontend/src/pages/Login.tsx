import { App, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import authApi from '../api/auth';
import { getErrorMessage } from '../api/request';
import { useAuthStore } from '../stores/useAuthStore';
import type { LoginRequest } from '../types/auth';

const { Title, Text } = Typography;

/**
 * 登录页（F-1 §9）：最基础 Ant Design 表单，不做正式 UI。
 * 流程：POST /api/auth/login → 写入 token → GET /api/auth/profile → 写入 Current User → 跳转 /
 */
export default function Login() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<LoginRequest>();
  const [loading, setLoading] = useState(false);

  const ready = useAuthStore((s) => s.ready);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setSession = useAuthStore((s) => s.setSession);
  const setUser = useAuthStore((s) => s.setUser);

  // 已登录用户访问 /login → 直接进入应用外壳
  // 注意：直接指向 /dashboard（而非 /），避免「/ → index → /dashboard」与本次跳转叠加成
  // 双重 replace 重定向竞态（实测会短暂停在 /）。
  if (ready && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (values: LoginRequest) => {
    setLoading(true);
    try {
      const loginRes = await authApi.login(values);
      const { accessToken, refreshToken, expiresIn } = loginRes.data.data;
      setSession(accessToken, refreshToken, expiresIn);

      // 登录返回的 user 与 profile 形状不同 ⇒ 统一以 profile 作为 Current User 唯一来源
      const profileRes = await authApi.profile();
      setUser(profileRes.data.data);

      message.success('登录成功');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // 后端错误体为 { code, message }；getErrorMessage 兼容网络错误与非 JSON 响应体
      message.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <Title level={3} style={{ margin: 0 }}>
            YSEM
          </Title>
          <Text type="secondary">请登录</Text>
        </div>
        <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="用户名" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="密码" autoComplete="current-password" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Login
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
