import React from 'react';
import { Modal, Typography } from 'antd';
import { AppstoreOutlined, ClusterOutlined } from '@ant-design/icons';

const { Text } = Typography;

export type CreateTarget = 'PRODUCT' | 'GROUP';

interface Option {
  key: CreateTarget;
  title: string;
  desc: string;
  icon: React.ReactNode;
}

interface Props {
  open: boolean;
  onCancel: () => void;
  onSelect: (target: CreateTarget) => void;
}

const OPTIONS: Option[] = [
  {
    key: 'PRODUCT',
    title: '单品',
    desc: '新建一个独立产品',
    icon: <AppstoreOutlined />,
  },
  {
    key: 'GROUP',
    title: '组合',
    desc: '新建一组产品，可包含多个单品',
    icon: <ClusterOutlined />,
  },
];

/**
 * 新建引导弹窗：作为「新建」的第一个弹窗，选择 单品 / 组合。
 * - 单品：走现有新建产品逻辑（工艺/受众/品类 → 主表单）
 * - 组合：直接创建空组合并打开组合管理弹窗
 */
export default function CreateTypeModal({ open, onCancel, onSelect }: Props) {
  return (
    <Modal
      title="新建产品"
      open={open}
      onCancel={onCancel}
      footer={null}
      width={460}
      destroyOnHidden
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '8px 0 4px' }}>
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.key)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 8,
              padding: 16,
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              background: '#fff',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#1677ff';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(22,119,255,0.18)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: 24, color: '#1677ff', lineHeight: 1 }}>{opt.icon}</span>
            <Text strong style={{ fontSize: 15 }}>{opt.title}</Text>
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.4 }}>{opt.desc}</Text>
          </button>
        ))}
      </div>
    </Modal>
  );
}
