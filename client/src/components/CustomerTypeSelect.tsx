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
}

export default function CustomerTypeSelect({ value, onChange, placeholder, allowClear = true, disabled }: Props) {
  const { t } = useTranslation();
  const types = useCustomerTypeStore((s) => s.types);
  const loading = useCustomerTypeStore((s) => s.loading);
  const fetchTypes = useCustomerTypeStore((s) => s.fetchTypes);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  return (
    <Select
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
