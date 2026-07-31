import { getCountryCode } from '../data/countries';

interface FlagIconProps {
  /** 国家中文名或 ISO 代码 */
  country?: string;
  style?: React.CSSProperties;
}

// 国旗图标组件（基于 flag-icons CSS）
export default function FlagIcon({ country, style }: FlagIconProps) {
  if (!country) return null;
  // 只能通过 ISO 两位字母代码模式来区分代码和中文名
  const isIsoCode = /^[A-Za-z]{2}$/.test(country);
  const code = isIsoCode ? country : getCountryCode(country);
  if (!code) return null;
  return (
    <span
      className={`fi fi-${code.toLowerCase()}`}
      style={{ width: 24, height: 18, lineHeight: '18px', ...style }}
    />
  );
}
