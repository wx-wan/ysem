import type { ReactNode } from 'react';
import { Row, Col } from 'antd';
import { useCardGutter } from '../tokens';

interface ResponsiveCardGridProps {
  dataSource: unknown[];
  renderItem: (item: any, index: number) => ReactNode;
  /** 响应式列配置，默认 xs=24 sm=12 md=8（1 / 2 / 3 列） */
  cols?: { xs?: number; sm?: number; md?: number; lg?: number; xl?: number };
  gutter?: [number, number] | number;
}

/**
 * 通用响应式卡片网格：数据源 + 渲染函数 + 断点列数。
 * 页面框架组件，供客户 / 产品等卡片视图复用。
 * 卡片间距默认随断点响应式（手机 12 / 默认 16 / 宽屏 20），由 tokens 统一调度。
 */
export default function ResponsiveCardGrid({
  dataSource,
  renderItem,
  cols = { xs: 24, sm: 12, md: 12, lg: 8 },
  gutter,
}: ResponsiveCardGridProps) {
  const cardGutter = useCardGutter();
  return (
    <Row gutter={gutter ?? cardGutter}>
      {dataSource.map((item, index) => (
        <Col key={(item as any)?.id ?? index} {...cols}>
          {renderItem(item, index)}
        </Col>
      ))}
    </Row>
  );
}
