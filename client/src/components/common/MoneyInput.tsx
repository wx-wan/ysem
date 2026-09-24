import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { InputNumber, Select, Space } from 'antd';
import { useCurrencyStore } from '../../stores/useCurrencyStore';

/**
 * 金额值 —— **对外字段固定**：币种 + 原币金额 + 汇率快照。
 * 凡是「钱」的字段都必须带这三个值（CNY 也带，汇率为 1）。
 */
export interface MoneyValue {
  /** 币种 code（CurrencyRate.code，如 CNY / USD） */
  currency: string;
  /** 原币金额（用户在输入框里填的数） */
  amount: number | null;
  /**
   * 汇率快照：1 单位该币种 = X CNY（与后端 ADR-18 `exchangeRate` 同义，CNY 恒为 1）。
   * 录入时把当时的汇率一并存下来，后续展示 / 全局币种切换都**固定用这个汇率**换算，
   * 不再取实时汇率，避免历史金额随汇率波动。
   */
  exchangeRate: number;
}

interface Props {
  value?: MoneyValue | null;
  onChange?: (val: MoneyValue) => void;
  disabled?: boolean;
  size?: 'small' | 'middle' | 'large';
  placeholder?: string;
  /** 金额小数位（默认 2） */
  precision?: number;
  min?: number;
  /** 币种下拉宽度（默认 88） */
  currencyWidth?: number;
  /** 可选币种白名单（按传入顺序展示）；不传则展示系统启用币种 */
  currencyCodes?: string[];
  style?: CSSProperties;
}

/** 按存储的汇率快照换算为 CNY（换算基准固定，不取实时汇率） */
export function moneyToCNY(value?: MoneyValue | null): number | null {
  if (!value || value.amount == null) return null;
  return value.amount * (value.exchangeRate || 1);
}

/** 按存储的汇率快照换算为指定币种金额 */
export function moneyConvert(value: MoneyValue | null | undefined, targetRateToCny: number): number | null {
  const cny = moneyToCNY(value);
  if (cny == null || !targetRateToCny) return null;
  return cny / targetRateToCny;
}

/**
 * 按原币格式化展示：**币种缩写（¥ / $）+ 保留两位小数的金额**，符号与代码不混用。
 * 不换算，展示录入时的币种与金额（换算统一用落库的汇率快照）。
 */
export function formatMoneyValue(
  value?: MoneyValue | null,
  currencies?: { code: string; symbol?: string }[],
): string | undefined {
  if (!value || value.amount == null) return undefined;
  const symbol = currencies?.find((c) => c.code === value.currency)?.symbol;
  const num = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value.amount);
  return `${symbol || value.currency}${num}`;
}

/** 取某币种当前汇率（rateToCny：1 单位该币种 = X CNY，CNY 恒为 1） */
export function currentRateOf(code: string, rates: Record<string, number>): number {
  if (!code || code === 'CNY') return 1;
  return rates[code] || 1;
}

/**
 * 金额录入公共组件（全系统通用）：前面选币种、后面填金额，受控值固定为 { currency, amount, exchangeRate }。
 * - 币种下拉**显示币种代码**（USD / CNY），取值统一来自「系统设置 → 数据管理 → 币种维护」的启用项
 *   （useCurrencyStore.fetchRates → GET /currencies/active），全系统共用同一份数据源；
 * - 切换币种时写入该币种当时的汇率；历史数据缺汇率时用当前汇率补一次，保证「钱必带汇率」；
 * - 个别字段如需收敛可选币种，才通过 `currencyCodes` 传入白名单。
 */
export default function MoneyInput({
  value,
  onChange,
  disabled,
  size,
  placeholder,
  precision = 2,
  min = 0,
  currencyWidth = 88,
  currencyCodes,
  style,
}: Props) {
  const { currencies, rates } = useCurrencyStore();
  // 可选币种：传入白名单时按其顺序取子集，否则取系统启用币种
  const options = currencyCodes?.length
    ? (currencyCodes
        .map((code) => currencies.find((c) => c.code === code))
        .filter((c): c is (typeof currencies)[number] => !!c))
    : currencies;
  const available = options.length ? options : currencies;
  const fallbackCode = available[0]?.code ?? 'CNY';
  const current: MoneyValue = value ?? { currency: fallbackCode, amount: null, exchangeRate: currentRateOf(fallbackCode, rates) };

  // 当前币种不在可选项内（如历史币种已被停用）时，回退到第一个可选项，避免下拉显示空值
  const code = available.some((c) => c.code === current.currency) ? current.currency : fallbackCode;

  // 汇率必带：值里没有汇率快照（历史数据）时，用当前汇率补一次
  useEffect(() => {
    if (!value || !value.currency) return;
    if (value.exchangeRate && value.exchangeRate > 0) return;
    onChange?.({ ...value, exchangeRate: currentRateOf(value.currency, rates) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.currency, value?.exchangeRate]);

  const emit = (next: Partial<MoneyValue>) => {
    onChange?.({
      currency: next.currency ?? code,
      amount: next.amount !== undefined ? next.amount : current.amount,
      exchangeRate: next.exchangeRate ?? current.exchangeRate ?? currentRateOf(code, rates),
    });
  };

  return (
    <Space.Compact style={{ width: '100%', ...style }}>
      <Select
        // 选项只显示币种缩写（¥ / $），符号与代码不混用；选中值与下拉项均居中（见 global.css）
        className="money-currency-select"
        classNames={{ popup: { root: 'money-currency-dropdown' } }}
        value={code}
        onChange={(nextCode: string) => emit({ currency: nextCode, exchangeRate: currentRateOf(nextCode, rates) })}
        // 选项显示币种代码（USD / CNY），取值来自系统设置 → 数据管理 → 币种维护（启用项）
        options={available.map((c) => ({
          value: c.code,
          label: <span className="money-currency-symbol">{c.code}</span>,
        }))}
        disabled={disabled}
        size={size}
        style={{ width: currencyWidth }}
      />
      <InputNumber
        value={current.amount}
        onChange={(amount) => emit({ amount: typeof amount === 'number' ? amount : null })}
        disabled={disabled}
        size={size}
        min={min}
        precision={precision}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0 }}
      />
    </Space.Compact>
  );
}
