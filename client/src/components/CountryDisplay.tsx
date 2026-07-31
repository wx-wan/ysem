import { Typography } from 'antd';
import { findCountry } from '../data/countries';
import FlagIcon from './FlagIcon';

const { Text } = Typography;

interface CountryDisplayProps {
  country?: string;
}

// 国家展示组件：国旗 + 中文名
export default function CountryDisplay({ country }: CountryDisplayProps) {
  if (!country) return <Text type="secondary">未知</Text>;
  const info = findCountry(country);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <FlagIcon country={country} style={{ borderRadius: 2 }} />
      <Text>{info?.zh || country}</Text>
    </span>
  );
}
