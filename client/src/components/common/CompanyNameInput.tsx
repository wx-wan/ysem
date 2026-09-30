import { AutoComplete } from 'antd';
import { useEffect, useState } from 'react';
import { customerApi, type OwnershipResult } from '../../api/customers';

/** 公司名称归属状态（onBlur 查询归属接口后得出） */
export type CompanyStatus = 'idle' | 'loading' | 'none' | 'other' | 'mine';

interface Props {
  /** 受控值（公司名称） */
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 透传给内部输入框的 id（Form.Item 关联 label 使用，a11y） */
  id?: string;
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
  /**
   * 查询中状态回调：归属查询开始 true、结束 false。
   * 组件自身不渲染任何状态提示——提示统一由父级在 label 行用 Tag 呈现，
   * 与「未建档 / 已建档」同款样式（仅颜色不同），不再挤在输入框右侧。
   */
  onQueryingChange?: (querying: boolean) => void;
}

/**
 * 轻量化公司名称输入组件：
 * - 输入完成后触发 onBlur，调用专用归属查询接口（跨全员、仅回 code + 主键 + 负责人姓名）；
 * - 四种归属（提示由父级渲染，本组件只回传判定结果）：
 *   1) NOT_FOUND（none）→ 父级显示「未建档」标签；
 *   2) OWNED_BY_OTHER（other）→ 父级显示「已由【x】负责」；
 *   3) IN_PUBLIC_SEA（other）→ 父级显示「已在公海」；
 *   4) OWNED_BY_ME（mine）→ 不显示内容，由父级比对信息变更。
 */
export default function CompanyNameInput({ value, onChange, disabled, placeholder, id, querySignal, options, onPick, onResolved, onQueryingChange }: Props) {
  const [status, setStatus] = useState<CompanyStatus>('idle');

  // 外部改值（如打开编辑回填、清空）时重置归属判定，避免残留上一次的标签；用户输入已在 onChange 中处理
  useEffect(() => {
    setStatus('idle');
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
    onQueryingChange?.(true);
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
      onQueryingChange?.(false);
    }
  };

  const handleBlur = () => {
    void runQuery(value ?? '');
  };

  return (
    <AutoComplete
      id={id}
      value={value}
      options={options?.map((o) => ({ ...o, value: o.label, id: o.value })) as any}
      disabled={disabled}
      placeholder={placeholder}
      allowClear
      style={{ width: '100%' }}
      onChange={(v) => {
        // 输入变化（含清空）即清空上一次的归属判定，待下次 blur / 选中重新查询
        if (status !== 'idle') setStatus('idle');
        onChange?.(v);
      }}
      onSelect={(v, option) => {
        // 选中既有客户：通知父级带入国家/地区·客户类型·来源渠道，并触发归属查询（校正 mine/other 状态）
        onPick?.(option as any);
        void runQuery(v);
      }}
      onBlur={handleBlur}
    />
  );
}
