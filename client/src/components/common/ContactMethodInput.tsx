import { Button, Input, Select, theme } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { forwardRef, useImperativeHandle, useState, type CSSProperties } from 'react';

export interface ContactMethodItem {
  tool: string;
  account: string;
}

/** 对外暴露的命令式方法（如把「新增」按钮放到 Form.Item label 旁时调用） */
export interface ContactMethodHandle {
  add: () => void;
  /** 逐字段校验（工具 / 账号分开判定是否有值），返回是否全部通过；不通过时组件内飘红 */
  validate: () => boolean;
  /** 清空校验状态（打开弹窗 / 重置表单时调用，避免上一次的错误提示残留） */
  reset: () => void;
}

type FieldName = 'tool' | 'account';

interface Props {
  value?: ContactMethodItem[];
  onChange?: (val: ContactMethodItem[]) => void;
  options?: { label: string; value: string }[];
  disabled?: boolean;
  /** 透传给内部 Select / Input 的 variant（outlined / filled / borderless / underlined），统一表单外观 */
  variant?: 'outlined' | 'filled' | 'borderless' | 'underlined';
  /** 透传给内部 Select / Input 的 size（small / middle / large） */
  size?: 'small' | 'middle' | 'large';
  /** 轻量模式：行距更紧、账号输入框自适应宽度、新增按钮改为内联 link 样式 */
  compact?: boolean;
  /** 是否内部渲染「新增」按钮（默认 true）；若把按钮放到 label 旁可设为 false，再用 ref.add() 触发 */
  showAddButton?: boolean;
}

/**
 * 联系方式录入公共组件：若干「沟通工具下拉 + 账号输入框」组合，支持新增 / 删除，默认至少一条。
 * 作为受控组件配合 antd Form.Item 使用（value / onChange）。
 *
 * 校验策略（字段级、分开判定，不依赖 Form.Item rules）：
 * - 「沟通工具」与「账号」各自独立判定是否有值，缺失哪一项就只提示哪一项；
 * - 字段一变化立即重判该字段：**有值即清除飘红**，无需等到失焦或提交；
 * - 未触发过校验（`validate()` 之前）不会主动飘红，避免边填边报错。
 */
const ContactMethodInput = forwardRef<ContactMethodHandle, Props>(function ContactMethodInput(
  { value, onChange, options = [], disabled, variant, size, compact, showAddButton = true },
  ref,
) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const list: ContactMethodItem[] = value && value.length ? value : [{ tool: '', account: '' }];
  /** 字段级错误：key = `${行索引}:${字段名}` */
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** 是否已触发过整体验证（未触发前不对空值主动飘红） */
  const [validated, setValidated] = useState(false);

  const fieldKey = (idx: number, field: FieldName) => `${idx}:${field}`;
  const messageOf = (field: FieldName) =>
    field === 'tool' ? t('lead.contactToolRequired') : t('lead.contactAccountRequired');

  const update = (next: ContactMethodItem[]) => onChange?.(next);

  /** 单个字段变化后即时重判：有值 → 清除该字段飘红；空值 → 仅在已验证过的前提下保留提示 */
  const revalidateField = (idx: number, field: FieldName, val: string) => {
    setErrors((prev) => {
      const key = fieldKey(idx, field);
      const next = { ...prev };
      if (val.trim()) {
        delete next[key];
      } else if (validated) {
        next[key] = messageOf(field);
      }
      return next;
    });
  };

  const setRow = (idx: number, patch: Partial<ContactMethodItem>) => {
    update(list.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    if ('tool' in patch) revalidateField(idx, 'tool', patch.tool ?? '');
    if ('account' in patch) revalidateField(idx, 'account', patch.account ?? '');
  };

  const removeRow = (idx: number) => {
    const next = list.filter((_, i) => i !== idx);
    // 至少保留一条，空数组会让表单里失去录入入口
    update(next.length ? next : [{ tool: '', account: '' }]);
    // 行号位移后错误索引失效，直接清空，下一次 validate / 字段变化重新判定
    setErrors({});
  };

  const addRow = () => {
    update([...list, { tool: '', account: '' }]);
  };

  useImperativeHandle(ref, () => ({
    add: addRow,
    validate: () => {
      const next: Record<string, string> = {};
      list.forEach((it, idx) => {
        if (!(it?.tool ?? '').trim()) next[fieldKey(idx, 'tool')] = messageOf('tool');
        if (!(it?.account ?? '').trim()) next[fieldKey(idx, 'account')] = messageOf('account');
      });
      setValidated(true);
      setErrors(next);
      return Object.keys(next).length === 0;
    },
    reset: () => {
      setValidated(false);
      setErrors({});
    },
  }));

  // 与 antd Form.Item 校验飘红文案保持一致：使用 token 字号与错误色，避免自定义 12px 偏小
  const errStyle: CSSProperties = {
    color: token.colorError,
    fontSize: token.fontSize,
    lineHeight: token.lineHeight,
    marginTop: 4,
  };

  return (
    <div>
      {list.map((it, idx) => {
        const toolError = errors[fieldKey(idx, 'tool')];
        const accountError = errors[fieldKey(idx, 'account')];
        return (
          <div key={idx} style={{ marginBottom: compact ? 4 : 8 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', width: compact ? 104 : 160 }}>
                <Select
                  placeholder={t('lead.contactToolPlaceholder')}
                  value={it.tool || undefined}
                  onChange={(v) => setRow(idx, { tool: v })}
                  options={options}
                  disabled={disabled}
                  variant={variant}
                  size={size}
                  style={{ width: '100%' }}
                  status={toolError ? 'error' : undefined}
                  showSearch
                  optionFilterProp="label"
                  allowClear
                />
                {toolError && <div style={errStyle}>{toolError}</div>}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <Input
                  placeholder={t('lead.contactAccountPlaceholder')}
                  value={it.account}
                  onChange={(e) => setRow(idx, { account: e.target.value })}
                  disabled={disabled}
                  variant={variant}
                  size={size}
                  maxLength={300}
                  status={accountError ? 'error' : undefined}
                />
                {accountError && <div style={errStyle}>{accountError}</div>}
              </div>
              {list.length > 1 && (
                <span style={{ display: 'inline-flex', alignItems: 'center', height: size === 'large' ? 40 : 32 }}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    disabled={disabled}
                    onClick={() => removeRow(idx)}
                    size={compact ? 'small' : undefined}
                  />
                </span>
              )}
            </div>
          </div>
        );
      })}
      {showAddButton &&
        (compact ? (
          <Button type="link" size="small" icon={<PlusOutlined />} onClick={addRow} disabled={disabled} style={{ paddingLeft: 0 }}>
            {t('lead.addContactMethod')}
          </Button>
        ) : (
          <Button type="dashed" icon={<PlusOutlined />} onClick={addRow} disabled={disabled} block>
            {t('lead.addContactMethod')}
          </Button>
        ))}
    </div>
  );
});

export default ContactMethodInput;
