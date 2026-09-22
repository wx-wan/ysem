import { App as AntdApp } from 'antd';
import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import AppRoutes from './router';
import { useAuthStore } from './stores/useAuthStore';

/** 应用根组件：装配 AntdApp（message/modal 上下文）与 Router，并在启动时恢复认证状态 */
export default function App() {
  const initialize = useAuthStore((s) => s.initialize);

  useEffect(() => {
    // 启动恢复：无 token → 直接 ready；有 token → GET /api/auth/profile（401 由 request 层 refresh + retry）
    void initialize();
  }, [initialize]);

  return (
    <AntdApp>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AntdApp>
  );
}
