import { Button, Input, Select, Space } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

export interface ContactMethodItem {
  tool: string;
  account: string;
}

interface Props {
  value?: ContactMethodItem[];
  onChange?: (val: ContactMethodItem[]) => void;
  options?: { label: string; value: string }[];
  disabled?: boolean;
}

/**
 * 联系方式录入公共组件：若干「沟通工具下拉 + 账号输入框」组合，支持新增 / 删除，默认至少一条。
 * 作为受控组件配合 antd Form.Item 使用（value / onChange）。
 */
export default function ContactMethodInput({ value, onChange, options = [], disabled }: Props) {
  const { t } = useTranslation();
  const list: ContactMethodItem[] = value && value.length ? value : [{ tool: '', account: '' }];

  const update = (next: ContactMethodItem[]) => onChange?.(next);

  const setRow = (idx: number, patch: Partial<ContactMethodItem>) => {
    update(list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeRow = (idx: number) => {
    update(list.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    update([...list, { tool: '', account: '' }]);
  };

  return (
    <div>
      {list.map((it, idx) => (
        <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
          <Select
            placeholder={t('lead.contactToolPlaceholder')}
            value={it.tool || undefined}
            onChange={(v) => setRow(idx, { tool: v })}
            options={options}
            disabled={disabled}
            style={{ width: 160 }}
            showSearch
            optionFilterProp="label"
            allowClear
          />
          <Input
            placeholder={t('lead.contactAccountPlaceholder')}
            value={it.account}
            onChange={(e) => setRow(idx, { account: e.target.value })}
            disabled={disabled}
            maxLength={300}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            disabled={disabled || list.length <= 1}
            onClick={() => removeRow(idx)}
          />
        </Space>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} disabled={disabled} block>
        {t('lead.addContactMethod')}
      </Button>
    </div>
  );
}
