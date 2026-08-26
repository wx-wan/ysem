import { Card, Row, Col, Skeleton } from 'antd';

interface PageSkeletonProps {
  /** table: 列表表格型；cards: 卡片网格型 */
  variant?: 'table' | 'cards';
  /** 顶部统计卡片数量（0 表示不显示） */
  statCards?: number;
  /** 表格/卡片占位行数 */
  rows?: number;
  /** 是否渲染页面标题区骨架 */
  title?: boolean;
}

/**
 * 通用页面骨架屏：用于首屏数据加载时的过渡占位，避免空白/重渲染闪烁。
 * 业务列表页在「loading 且数据为空」时渲染本组件即可。
 */
export default function PageSkeleton({
  variant = 'table',
  statCards = 0,
  rows = 6,
  title = true,
}: PageSkeletonProps) {
  return (
    <div>
      {title && (
        <div className="page-header" style={{ marginBottom: 16 }}>
          <Skeleton.Input active size="large" style={{ width: 200 }} />
          <div style={{ height: 8 }} />
          <Skeleton.Input active size="small" style={{ width: 320 }} />
        </div>
      )}

      {statCards > 0 && (
        <Row gutter={16} style={{ marginBottom: 24 }}>
          {Array.from({ length: statCards }).map((_, i) => (
            <Col xs={12} md={24 / Math.min(statCards, 4)} key={i}>
              <Card size="small" variant="borderless" style={{ minHeight: 108 }}>
                <Skeleton active title={false} paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {variant === 'table' ? (
        <Card style={{ borderRadius: 12 }}>
          <Skeleton active paragraph={{ rows }} />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {Array.from({ length: rows }).map((_, i) => (
            <Col xs={24} md={12} xl={8} key={i}>
              <Card>
                <Skeleton active avatar paragraph={{ rows: 3 }} />
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
