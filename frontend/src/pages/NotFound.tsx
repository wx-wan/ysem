import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

/** 404 占位页（Round F-3 §17）：仅 Result + 返回首页 */
export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="404"
      subTitle="抱歉，该页面不存在。"
      extra={
        <Button type="primary" onClick={() => navigate('/')}>
          Back Home
        </Button>
      }
    />
  );
}
