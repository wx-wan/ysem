import type { CSSProperties, ReactNode } from 'react';
import { Col, Row } from 'antd';

export interface StatCardItem {
  key: string;
  /** 标题（如 客户总数 / 预计商机金额） */
  label: ReactNode;
  /** 主数值 */
  value: ReactNode;
  /** 副信息（右下角小字 / 查看详情等） */
  sub?: ReactNode;
  /** 渐变起始色 */
  from: string;
  /** 渐变结束色 */
  to: string;
  /** 装饰圆颜色 */
  accent?: string;
  /** 右侧大图标 */
  icon?: ReactNode;
}

interface StatCardsProps {
  items: StatCardItem[];
  /** 响应式列配置，默认 xs=24 sm=12 md=8（1 / 2 / 3 列） */
  cols?: { xs?: number; sm?: number; md?: number; lg?: number; xl?: number };
  /** 卡片间距，默认 [16, 16] */
  gutter?: [number, number] | number;
  /** 容器额外样式（如控制与下方区块的间距） */
  style?: CSSProperties;
}

/**
 * 通用数据统计卡：渐变底 + 装饰圆 + 大图标 + 数值。
 * 页面框架组件，供客户 / 仪表盘等页面复用。
 */
export default function StatCards({
  items,
  cols = { xs: 24, sm: 12, md: 12, lg: 8 },
  gutter = [16, 16],
  style,
}: StatCardsProps) {
  return (
    <Row gutter={gutter} style={style}>
      {items.map((item) => (
        <Col key={item.key} {...cols}>
          <div
            style={{
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 16,
              padding: '24px 28px',
              background: `linear-gradient(135deg, ${item.from} 0%, ${item.to} 100%)`,
              color: '#fff',
            }}
          >
            {/* 装饰圆 1 */}
            <div
              style={{
                position: 'absolute',
                top: -40,
                right: -40,
                width: 140,
                height: 140,
                borderRadius: '50%',
                background: item.accent,
                pointerEvents: 'none',
              }}
            />
            {/* 装饰圆 2 */}
            <div
              style={{
                position: 'absolute',
                bottom: -30,
                right: 60,
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: item.accent,
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'relative',
                zIndex: 1,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    color: 'rgba(255,255,255,0.75)',
                    fontWeight: 500,
                    lineHeight: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    marginTop: 8,
                    fontVariantNumeric: 'tabular-nums',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.value}
                </div>
                {item.sub && (
                  <div
                    style={{
                      fontSize: 12,
                      color: 'rgba(255,255,255,0.65)',
                      marginTop: 6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.sub}
                  </div>
                )}
              </div>
              {item.icon && (
                <div style={{ display: 'flex', alignItems: 'center', marginLeft: 16, flexShrink: 0 }}>
                  {item.icon}
                </div>
              )}
            </div>
          </div>
        </Col>
      ))}
    </Row>
  );
}
