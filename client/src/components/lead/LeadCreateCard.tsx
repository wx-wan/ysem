import { Space, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

interface Props {
  onClick: () => void;
}

/** 新建线索入口卡片（渐变高亮，点击打开新建弹窗） */
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
        background: `linear-gradient(90deg, ${token.colorPrimaryBg} 0%, ${token.colorPrimaryBgHover} 100%)`,
        boxShadow: token.boxShadowSecondary,
        transition: 'all .2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = `0 4px 16px ${token.colorPrimaryBg}`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = token.boxShadowSecondary;
      }}
    >
      <Space size={10}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            borderRadius: 8,
            background: token.colorPrimary,
            color: '#fff',
            fontSize: 16,
          }}
        >
          <PlusOutlined />
        </span>
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: token.colorText }}>{t('lead.createTitle')}</div>
          <div style={{ fontSize: 12, color: token.colorTextSecondary }}>{t('lead.createDesc')}</div>
        </div>
      </Space>
    </div>
  );
}
