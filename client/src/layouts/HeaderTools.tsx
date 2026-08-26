import { useMemo } from 'react';
import { Avatar, Badge, Dropdown } from 'antd';
import {
  UserOutlined,
  BellOutlined,
  TranslationOutlined,
  DollarOutlined,
  LogoutOutlined,
  KeyOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore, CURRENCIES } from '../stores/useCurrencyStore';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
import type { MenuProps } from 'antd';

interface HeaderToolsProps {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  onLogout: () => void;
  onMenuClick: MenuProps['onClick'];
}

export default function HeaderTools({ user, onLogout, onMenuClick }: HeaderToolsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hasPerm } = usePermission();
  const { currency, rates } = useCurrencyStore();
  // 响应式计算汇率展示文本（直接读 getState 不会随 rates 更新重新渲染）
  const rateToCNY = useMemo(() => {
    if (currency.code === 'CNY') return null;
    const r = rates[currency.code];
    if (!r) return null;
    const toCNY = 1 / r;
    if (currency.code === 'JPY' || currency.code === 'KRW') {
      return `1 ${currency.code} ≈ ${toCNY.toFixed(4)} CNY`;
    }
    return `1 ${currency.code} ≈ ${toCNY.toFixed(3)} CNY`;
  }, [currency, rates]);
  const currentLang = i18n.language;

  const toggleLanguage = () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(nextLang);
  };

  const handleAvatarMenuClick: MenuProps['onClick'] = (info) => {
    if (info.key === 'logout') onLogout();
    else if (info.key === 'profile') navigate('/profile');
    else if (info.key === 'settings') navigate('/setting');
    else onMenuClick?.(info);
  };

  // 拥有任一设置权限才显示「设置」入口（否则普通用户不应进入系统设置）
  const canOpenSettings = [
    'system:user',
    'system:role',
    'system:dept',
    'system:perm',
    'product:taxonomy:view',
    'system:channel',
    'system:customer-type',
    'system:approval',
    'system:logs',
  ].some((code) => hasPerm(code));

  const avatarMenuItems: MenuProps['items'] = [
    ...(canOpenSettings
      ? [
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: t('header.systemDesign'),
          },
        ]
      : []),
    {
      key: 'password',
      icon: <KeyOutlined />,
      label: t('header.changePassword'),
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: t('header.logout'),
      danger: true,
    },
  ];

  return (
    <div className="header-tools">
      <Badge dot>
        <BellOutlined className="tool-icon" />
      </Badge>

      <div className="lang-switch" onClick={toggleLanguage}>
        <TranslationOutlined />
        <span>{currentLang === 'zh' ? 'EN' : '中文'}</span>
      </div>

      <Dropdown
        menu={{
          items: CURRENCIES.map((c) => ({
            key: c.code,
            label: (
              <span>
                <span style={{ marginRight: 8 }}>{c.symbol}</span>
                {c.code} — {currentLang === 'zh' ? c.labelZh : c.label}
              </span>
            ),
          })),
          selectedKeys: [currency.code],
          onClick: ({ key }) => useCurrencyStore.getState().setCurrency(key),
        }}
        placement="bottomRight"
      >
        <div className="lang-switch currency-switch">
          <DollarOutlined />
          <span>{currency.code}</span>
        </div>
      </Dropdown>

      {rateToCNY && (
        <span className="exchange-rate-display">{rateToCNY}</span>
      )}

      <Dropdown
        menu={{
          items: avatarMenuItems,
          onClick: handleAvatarMenuClick,
        }}
        placement="bottomRight"
      >
        <div className="user-avatar">
          <Avatar src={user?.avatar} icon={<UserOutlined />} size="small" />
          <div className="user-info">
            <span className="user-name">{user?.realName || user?.username || t('common.noData')}</span>
            <span className="user-role">{user?.role?.name || t('menu.systemUser')}</span>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
