import React from 'react';
import { Tag, Typography, theme } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text } = Typography;

export interface SalesRecordCardProps {
  /** 类型标签文字，如 商机 / 报价 / 打样 / 销售订单 / 线索 */
  typeLabel: string;
  /** 类型标签颜色 */
  typeColor?: string;
  /** 状态标签文字（可选） */
  statusLabel?: string;
  /** 状态标签颜色 */
  statusColor?: string;
  /** 主标题（名称 / 单据号 / 客户名） */
  title: string;
  /** 第二行详情（建议用若干 <span> 拼接） */
  detail?: React.ReactNode;
  /** 创建时间（ISO 字符串） */
  createdAt?: string;
  /** 点击查看回调；提供后卡片可点击并显示「查看 ›」 */
  onClick?: () => void;
}

/**
 * 销售记录统一卡片：产品详情与客户详情共用，避免两边重复维护。
 * 布局固定为三行：行1 类型标签 + 状态标签 + 名称；行2 详情细节；行3 创建时间。
 * 仅保留「查看」交互，不内嵌任何操作按钮（编辑 / 转化 / 删除等）。
 */
const SalesRecordCard: React.FC<SalesRecordCardProps> = ({
  typeLabel,
  typeColor = 'blue',
  statusLabel,
  statusColor,
  title,
  detail,
  createdAt,
  onClick,
}) => {
  const { token } = theme.useToken();
  const clickable = Boolean(onClick);

  const hover = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = `0 6px 20px ${token.colorPrimary}14`;
    e.currentTarget.style.borderColor = token.colorPrimary + '40';
    e.currentTarget.style.transform = 'translateY(-1px)';
  };
  const leave = (e: React.MouseEvent<HTMLDivElement>) => {
    e.currentTarget.style.boxShadow = 'none';
    e.currentTarget.style.borderColor = token.colorBorderSecondary;
    e.currentTarget.style.transform = 'translateY(0)';
  };

  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 16,
        padding: '16px 20px',
        transition: 'all 0.2s ease',
        ...(clickable ? { cursor: 'pointer' } : {}),
      }}
      onClick={onClick}
      onMouseEnter={clickable ? hover : undefined}
      onMouseLeave={clickable ? leave : undefined}
    >
      {/* 行1：类型 + 状态 + 名称 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag color={typeColor} style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
          {typeLabel}
        </Tag>
        {statusLabel ? (
          <Tag color={statusColor} style={{ margin: 0, fontSize: 11, padding: '0 8px', lineHeight: '20px', borderRadius: 10, border: 'none', fontWeight: 500 }}>
            {statusLabel}
          </Tag>
        ) : null}
        <Text strong ellipsis style={{ fontSize: 14, color: token.colorTextHeading, flex: 1, minWidth: 0 }}>
          {title}
        </Text>
        {clickable ? <span style={{ fontSize: 12, color: token.colorPrimary, fontWeight: 600 }}>查看 ›</span> : null}
      </div>
      {/* 行2：详情细节 */}
      {detail ? (
        <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {detail}
        </div>
      ) : null}
      {/* 行3：创建时间 */}
      {createdAt ? (
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 6 }}>
          <ClockCircleOutlined style={{ marginRight: 4, fontSize: 10 }} />
          {dayjs(createdAt).format('YYYY-MM-DD HH:mm')}
        </div>
      ) : null}
    </div>
  );
};

export default SalesRecordCard;
