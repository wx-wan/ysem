import { Space, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  onClick: () => void;
}

/** 新建线索入口卡片（与参考图一致：浅蓝底色 + 蓝色虚线边框 + 左侧加号） */
export default function LeadCreateCard({ onClick }: Props) {
  const { t } = useTranslation();
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
          <div style={{ fontSize: 15, fontWeight: 600, color: token.colorPrimary }}>{t('lead.createTitle')}</div>
          <div style={{ fontSize: 13, color: token.colorTextSecondary }}>{t('lead.createDesc')}</div>
        </div>
      </Space>
    </div>
  );
}
