import { useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface SyncNavigateProps {
  to: string;
  replace?: boolean;
}

/**
 * 同步重定向组件：使用 useLayoutEffect 在浏览器绘制前触发导航，
 * 避免 react-router 的 <Navigate>（内部用 useEffect，绘制后才跳转）
 * 造成的首帧空白/闪烁。
 */
export default function SyncNavigate({ to, replace = true }: SyncNavigateProps) {
  const navigate = useNavigate();
  useLayoutEffect(() => {
    navigate(to, { replace });
  }, [navigate, to, replace]);
  return null;
}
