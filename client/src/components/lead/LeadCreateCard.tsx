import { useTranslation } from 'react-i18next';
import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { theme } from 'antd';

interface Props {
  onClick: () => void;
}

/** 列表页「新建线索」醒目 CTA（渐变 + 大按钮，参考图入口风格） */
export default function LeadCreateCard({ onClick }: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className="lead-create-cta"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '20px 24px',
        marginBottom: 16,
        borderRadius: token.borderRadiusLG,
        cursor: 'pointer',
        background: 'linear-gradient(135deg, #f0f7ff 0%, #e0efff 100%)',
        color: 'var(--c-text, #1e293b)',
        boxShadow: '0 6px 20px rgba(22, 119, 255, 0.12)',
        transition: 'transform .18s ease, box-shadow .18s ease',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 10px 26px rgba(22, 119, 255, 0.18)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 6px 20px rgba(22, 119, 255, 0.12)';
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 14,
          background: 'rgba(22, 119, 255, 0.12)',
          color: 'var(--c-primary, #1677ff)',
          fontSize: 24,
          flexShrink: 0,
        }}
      >
        <PlusOutlined />
      </span>
      <div style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--c-text, #1e293b)' }}>{t('lead.createTitle')}</div>
        <div style={{ fontSize: 13, color: 'var(--c-text-secondary, #64748b)', marginTop: 2 }}>
          {t('lead.createDesc')}
        </div>
      </div>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: '50%',
          background: 'var(--c-primary, #1677ff)',
          color: '#fff',
          fontSize: 16,
          flexShrink: 0,
        }}
      >
        <RightOutlined />
      </span>
    </div>
  );
}
