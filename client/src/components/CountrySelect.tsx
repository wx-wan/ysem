import { Select } from 'antd';
import { COUNTRIES, findCountry } from '../data/countries';
import FlagIcon from './FlagIcon';

// 供外部使用
export { findCountry };

interface CountrySelectProps<T = string> {
  value?: T;
  onChange?: (value: T) => void;
  placeholder?: string;
  style?: React.CSSProperties;
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
  /** 只读形态：渲染静态「国旗 + 文字」，无下拉、不可交互（用于卡片/详情展示） */
  readOnly?: boolean;
}

// 国家选择器（带搜索）
export default function CountrySelect({
  value,
  onChange,
  placeholder = '选择国家',
  style,
  getPopupContainer,
  readOnly,
}: CountrySelectProps) {
  // 只读形态：静态展示，不渲染下拉
  if (readOnly) {
    const info = findCountry(value as string);
    const zh = info?.zh || (value as string) || '未知';
    const code = info?.code || '';
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          minHeight: 40,
          lineHeight: 1.4,
          ...style,
        }}
      >
        <FlagIcon country={value as string} style={{ borderRadius: 2 }} />
        <span>
          {zh}
          {code ? ` · ${code}` : ''}
        </span>
      </span>
    );
  }

  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      getPopupContainer={getPopupContainer}
      showSearch
      style={{ width: '100%', minHeight: 40, borderRadius: 8, ...style }}
      styles={{ popup: { root: { minWidth: 220 } } }}
      allowClear
      filterOption={(input, option) => {
        const children = (option?.children as unknown as string) || '';
        return children.toLowerCase().indexOf((input ?? '').toLowerCase()) >= 0;
      }}
      optionRender={({ value: optValue, label }) => {
        const info = findCountry(optValue as string);
        if (info) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <FlagIcon country={info.code} style={{ borderRadius: 2 }} />
              {info.zh}{info.en !== info.zh ? ` (${info.en})` : ''}
            </span>
          );
        }
        return <span style={{ display: 'inline-flex', alignItems: 'center' }}>{label}</span>;
      }}
      labelRender={({ value: selValue, label }) => {
        const info = findCountry(selValue as string);
        if (info) {
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: '22px' }}>
              <FlagIcon country={info.code} style={{ borderRadius: 2 }} />
              {info.zh}
            </span>
          );
        }
        return <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: '22px' }}>{label}</span>;
      }}
    >
      {COUNTRIES.map((c) => (
        <Select.Option key={c.code} value={c.zh}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <FlagIcon country={c.code} style={{ borderRadius: 2 }} />
            {c.zh}
          </span>
        </Select.Option>
      ))}
    </Select>
  );
}
