import { useEffect } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import { useCustomerTypeStore } from '../stores/useCustomerTypeStore';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
  /** 透传给内部 Select 的 id（供 Form.Item 关联 label 使用，a11y） */
  id?: string;
  /** 透传给内部 Select 的 variant（outlined / filled / borderless），用于统一表单外观 */
  variant?: 'outlined' | 'filled' | 'borderless' | 'underlined';
  /** 透传给内部 Select 的 size（small / middle / large） */
  size?: 'small' | 'middle' | 'large';
  /** 透传给内部 Select 的样式（宽度 / 圆角等，与所在表单统一） */
  style?: React.CSSProperties;
  /**
   * 透传给内部 Select 的浮层容器。抽屉等自定义 portal 层级高于 antd 默认浮层（body），
   * 必须挂到容器内，否则下拉会被遮住。
   */
  getPopupContainer?: (node: HTMLElement) => HTMLElement;
}

export default function CustomerTypeSelect({ value, onChange, placeholder, allowClear = true, disabled, id, variant, size, style, getPopupContainer }: Props) {
  const { t } = useTranslation();
  const types = useCustomerTypeStore((s) => s.types);
  const loading = useCustomerTypeStore((s) => s.loading);
  const fetchTypes = useCustomerTypeStore((s) => s.fetchTypes);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  return (
    <Select
      id={id}
      value={value}
      onChange={onChange}
      variant={variant}
      size={size}
      placeholder={placeholder || t('customerType.selectPlaceholder')}
      options={types.map((item) => ({ label: item.name, value: item.name }))}
      loading={loading}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      notFoundContent={t('customerType.noData')}
      style={style}
      getPopupContainer={getPopupContainer}
    />
  );
}
