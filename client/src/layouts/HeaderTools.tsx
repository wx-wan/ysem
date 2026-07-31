import { Avatar, Badge, Dropdown } from 'antd';
import {
  SettingOutlined,
  UserOutlined,
  TeamOutlined,
  ApartmentOutlined,
  SafetyOutlined,
  BellOutlined,
  TranslationOutlined,
  DollarOutlined,
  LogoutOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { useAuthStore } from '../stores/useAuthStore';
import { useCurrencyStore, CURRENCIES } from '../stores/useCurrencyStore';
import { useNavigate } from 'react-router-dom';
import type { MenuProps } from 'antd';

interface HeaderToolsProps {
  user: ReturnType<typeof useAuthStore.getState>['user'];
  onLogout: () => void;
  onMenuClick: MenuProps['onClick'];
}

export default function HeaderTools({ user, onLogout, onMenuClick }: HeaderToolsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currency } = useCurrencyStore();
  const rateToCNY = useCurrencyStore.getState().getRateToCNY();
  const currentLang = i18n.language;

  const roleCode = user?.role?.code || 'user';
  const hasSystemAccess = roleCode === 'admin';

  const toggleLanguage = () => {
    const nextLang = currentLang === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(nextLang);
  };

  const handleAvatarMenuClick: MenuProps['onClick'] = (info) => {
    if (info.key === 'logout') onLogout();
    else if (info.key === 'profile') navigate('/profile');
    else onMenuClick?.(info);
  };

  const avatarMenuItems: MenuProps['items'] = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: t('header.profile'),
    },
    {
      key: 'password',
      icon: <KeyOutlined />,
      label: t('header.changePassword'),
    },
    ...(hasSystemAccess
      ? [
          {
            key: 'system',
            icon: <SettingOutlined />,
            label: t('menu.system'),
            children: [
              { key: '/system/user', icon: <UserOutlined />, label: t('menu.systemUser') },
              { key: '/system/role', icon: <TeamOutlined />, label: t('menu.systemRole') },
              { key: '/system/dept', icon: <ApartmentOutlined />, label: t('menu.systemDept') },
              { key: '/system/perm', icon: <SafetyOutlined />, label: t('menu.systemPerm') },
            ],
          },
        ]
      : []),
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
          <Avatar icon={<UserOutlined />} size="small" />
          <div className="user-info">
            <span className="user-name">{user?.realName || user?.username || t('common.noData')}</span>
            <span className="user-role">{user?.role?.name || t('menu.systemUser')}</span>
          </div>
        </div>
      </Dropdown>
    </div>
  );
}
