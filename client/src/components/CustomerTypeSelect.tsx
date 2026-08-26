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
}

export default function CustomerTypeSelect({ value, onChange, placeholder, allowClear = true, disabled, id }: Props) {
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
      placeholder={placeholder || t('customerType.selectPlaceholder')}
      options={types.map((item) => ({ label: item.name, value: item.name }))}
      loading={loading}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      notFoundContent={t('customerType.noData')}
    />
  );
}
