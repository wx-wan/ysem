import { Space, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

interface Props {
  onClick: () => void;
  title: string;
  description?: string;
}

/** 列表页「新建」入口卡片：浅主色底 + 主色虚线边框 + 左侧加号图标（新建线索 / 新建商机等共用） */
export default function CreateEntryCard({ onClick, title, description }: Props) {
  const { token } = theme.useToken();

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 18px',
        marginBottom: 16,
        borderRadius: token.borderRadiusLG,
        cursor: 'pointer',
        background: token.colorPrimaryBg,
        border: `1px dashed ${token.colorPrimary}`,
        transition: 'all .2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = token.colorPrimaryBgHover;
        e.currentTarget.style.borderStyle = 'solid';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = token.colorPrimaryBg;
        e.currentTarget.style.borderStyle = 'dashed';
      }}
    >
      <Space size={10}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: token.borderRadius,
            background: token.colorPrimary,
            color: '#fff',
            fontSize: 18,
          }}
        >
          <PlusOutlined />
        </span>
        <div style={{ lineHeight: 1.4 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: token.colorPrimary }}>{title}</div>
          {description && <div style={{ fontSize: 13, color: token.colorTextSecondary }}>{description}</div>}
        </div>
      </Space>
    </div>
  );
}
