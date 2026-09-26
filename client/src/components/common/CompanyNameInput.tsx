import { Input, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useEffect, useState, type CSSProperties } from 'react';
import { customerApi, type OwnershipResult } from '../../api/customers';

/** 公司名称归属状态（onBlur 查询归属接口后得出） */
export type CompanyStatus = 'idle' | 'loading' | 'none' | 'other' | 'mine';

interface Props {
  /** 受控值（公司名称） */
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * 查询完成回调：返回归属状态、命中客户主键、负责人姓名（他人时）与是否公海、
   * 以及被查询的公司名称（供父级匹配 / 关联客户、判断是否信息变更）。
   * 不再回传完整客户对象——归属判定已由后端专用轻量接口完成。
   */
  onResolved?: (info: {
    status: CompanyStatus;
    companyName?: string;
    customerId?: string;
    ownerName?: string;
    publicSea?: boolean;
  }) => void;
}

/**
 * 轻量化公司名称输入组件：
 * - 输入完成后触发 onBlur，调用专用归属查询接口（跨全员、仅回 code + 主键 + 负责人姓名）；
 * - 四种归属：
 *   1) NOT_FOUND（none）→ 显示「未建档」标签；
 *   2) OWNED_BY_OTHER（other）→ 显示「已由【x】负责」；
 *   3) IN_PUBLIC_SEA（other）→ 显示「已在公海」；
 *   4) OWNED_BY_ME（mine）→ 不显示内容，由父级比对信息变更。
 */
export default function CompanyNameInput({ value, onChange, disabled, placeholder, onResolved }: Props) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [status, setStatus] = useState<CompanyStatus>('idle');
  const [info, setInfo] = useState<{ customerId?: string; ownerName?: string; publicSea?: boolean } | null>(null);
  const [querying, setQuerying] = useState(false);

  // 外部改值（如打开编辑回填、清空）时重置归属判定，避免残留上一次的标签；用户输入已在 onChange 中处理
  useEffect(() => {
    setStatus('idle');
    setInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const resolve = (name: string, next: CompanyStatus, extra: { customerId?: string; ownerName?: string; publicSea?: boolean } = {}) => {
    setInfo(extra);
    setStatus(next);
    onResolved?.({ status: next, companyName: name, ...extra });
  };

  const handleBlur = async () => {
    const name = (value ?? '').trim();
    if (!name) {
      resolve('', 'idle');
      return;
    }
    setQuerying(true);
    try {
      const res = await customerApi.checkOwnership(name);
      const data: OwnershipResult | undefined = res?.data?.data;
      if (!data) {
        resolve(name, 'idle');
        return;
      }
      switch (data.code) {
        case 'NOT_FOUND':
          resolve(name, 'none');
          break;
        case 'OWNED_BY_ME':
          resolve(name, 'mine', { customerId: data.customerId });
          break;
        case 'IN_PUBLIC_SEA':
          resolve(name, 'other', { customerId: data.customerId, publicSea: true });
          break;
        case 'OWNED_BY_OTHER':
        default:
          resolve(name, 'other', { customerId: data.customerId, ownerName: data.ownerName });
          break;
      }
    } catch {
      // 查询失败不阻断输入：退化为 idle（按名称落库由公司名文本承担）
      resolve(name, 'idle');
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        allowClear
        style={{ flex: 1, minWidth: 0 }}
        onChange={(e) => {
          // 输入变化即清空上一次的归属判定，待下次 blur 重新查询
          if (status !== 'idle') {
            setStatus('idle');
            setInfo(null);
          }
          onChange?.(e.target.value);
        }}
        onBlur={handleBlur}
      />
      {querying && (
        <span style={{ flexShrink: 0, fontSize: 12, color: 'rgba(0,0,0,0.45)', whiteSpace: 'nowrap' }}>
          {t('common.loading')}
        </span>
      )}
      {!querying && status === 'other' && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 12,
            color: 'var(--c-text-tertiary, #94a3b8)',
            whiteSpace: 'nowrap',
          }}
        >
          {info?.publicSea
            ? t('lead.customerInPublicSea')
            : t('lead.customerOwnedByOther', {
                name: info?.ownerName || t('common.someone'),
              })}
        </span>
      )}
    </div>
  );
}
