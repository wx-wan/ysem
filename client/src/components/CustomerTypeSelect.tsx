import { useEffect, useState } from 'react';
import { Select } from 'antd';
import { useTranslation } from 'react-i18next';
import customerTypeApi from '../api/customerType';

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  disabled?: boolean;
}

export default function CustomerTypeSelect({ value, onChange, placeholder, allowClear = true, disabled }: Props) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    customerTypeApi
      .getActive()
      .then((res) => {
        const list = res.data.data || [];
        setOptions(list.map((item) => ({ label: item.name, value: item.name })));
      })
      .catch(() => setOptions([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder={placeholder || t('customerType.selectPlaceholder')}
      options={options}
      loading={loading}
      allowClear={allowClear}
      disabled={disabled}
      showSearch
      optionFilterProp="label"
      notFoundContent={t('customerType.noData')}
    />
  );
}
