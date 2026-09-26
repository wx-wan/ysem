import { AutoComplete, theme } from 'antd';
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
   * 实时查询信号（每次打开弹窗自增）。打开弹窗（含编辑回填 / 重开草稿）时已带公司名时，
   * 组件据此立即查询归属接口，确保标签反映最新状态，而非依赖线索冗余字段（customerId 缺失）派生。
   */
  querySignal?: number | string;
  /** 既有客户下拉选项（用于快速选择已建档客户）。选中即通过 onPick 回传完整选项，供父级带入国家/地区·客户类型·来源渠道 */
  options?: Array<{ label: string; value: string; [key: string]: any }>;
  /** 选中下拉客户回调：回传完整选项对象（value=公司名、id=客户主键、以及 country / customerType / channelId / shopId 等） */
  onPick?: (opt: { label: string; value: string; id?: string; [key: string]: any }) => void;
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
export default function CompanyNameInput({ value, onChange, disabled, placeholder, querySignal, options, onPick, onResolved }: Props) {
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

  // 打开弹窗信号（querySignal 变化 / 首次挂载）：若已带公司名则实时查询归属接口，
  // 确保标签反映最新状态，而非依赖线索冗余字段（customerId 缺失）派生
  useEffect(() => {
    const name = (value ?? '').trim();
    if (name) void runQuery(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySignal]);

  const resolve = (name: string, next: CompanyStatus, extra: { customerId?: string; ownerName?: string; publicSea?: boolean } = {}) => {
    setInfo(extra);
    setStatus(next);
    onResolved?.({ status: next, companyName: name, ...extra });
  };

  // 实时归属查询：打开弹窗（querySignal）或失焦（onBlur）均走这里；失败退化为 idle 不阻断输入
  const runQuery = async (raw: string) => {
    const name = raw.trim();
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

  const handleBlur = () => {
    void runQuery(value ?? '');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <AutoComplete
        value={value}
        options={options?.map((o) => ({ ...o, value: o.label, id: o.value })) as any}
        disabled={disabled}
        placeholder={placeholder}
        allowClear
        style={{ flex: 1, minWidth: 0 }}
        onChange={(v) => {
          // 输入变化（含清空）即清空上一次的归属判定，待下次 blur / 选中重新查询
          if (status !== 'idle') {
            setStatus('idle');
            setInfo(null);
          }
          onChange?.(v);
        }}
        onSelect={(v, option) => {
          // 选中既有客户：通知父级带入国家/地区·客户类型·来源渠道，并触发归属查询（校正 mine/other 状态）
          onPick?.(option as any);
          void runQuery(v);
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
