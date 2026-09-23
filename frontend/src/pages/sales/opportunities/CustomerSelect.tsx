import { Select, Typography } from 'antd';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { getCustomerOptions } from '../../../api/customers';
import { getErrorMessage } from '../../../api/request';
import type { CustomerOption } from '../../../types/customer';

const { Text } = Typography;

export interface CustomerSelectProps {
  /** 受控值 = Customer.id（可直接作为 antd Form.Item 子组件使用） */
  value?: string | null;
  onChange?: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  style?: CSSProperties;
  /**
   * 当前值兜底（例如由客户详情带入、或该客户不在当前选项集合中）：
   * 仅用于**保留显示**，不放宽后端可见性，也不把不可选项变成可选。
   * `companyName` 可缺省（此时显示「当前客户」）—— 选项载入后若命中真实记录，会自动改用真实名称。
   */
  fallbackOption?: { id: string; companyName?: string | null; customerNo?: string | null } | null;
}

/**
 * 客户选择（Round F-S2）
 *
 * 数据源：GET /api/customers/options（**后端既有端点**，按 roleScope 过滤、无分页）
 *   —— 由 F-S2 在 api/customers.ts 中补只读绑定（`getCustomerOptions`），未改变任何 Customer 契约。
 *   —— F-4A 已判定 customerOptions 为 page-level 数据集（不进入 master data store）⇒ 本组件在
 *      Modal 打开时按需加载一次，不建立全局缓存。
 *
 * 设计边界：
 *   · 只负责「选一个真实客户」，不写入任何数据；
 *   · 选项搜索为**客户端过滤**（端点为一次性全量返回，无 keyword 参数）；
 *   · 不提供「新建客户」入口（客户创建属 Customer 域）。
 */
export default function CustomerSelect({
  value,
  onChange,
  disabled,
  placeholder = '选择客户',
  allowClear = false,
  style,
  fallbackOption,
}: CustomerSelectProps) {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getCustomerOptions()
      .then((list) => {
        if (!cancelled) setCustomers(list);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const list = customers.map((customer) => ({
      label: customer.customerNo ? `${customer.companyName}（${customer.customerNo}）` : customer.companyName,
      value: customer.id,
    }));
    // 历史值 / 详情带入值兜底：仅当不在选项集合中时追加（选项载入后若命中真实记录，本兜底自动消失）
    if (fallbackOption && !list.some((option) => option.value === fallbackOption.id)) {
      const suffix = fallbackOption.customerNo ? `（${fallbackOption.customerNo}）` : '';
      const name = fallbackOption.companyName?.trim() || '当前客户';
      list.unshift({ label: `${name}${suffix}（当前值，不在可选列表中）`, value: fallbackOption.id });
    }
    return list;
  }, [customers, fallbackOption]);

  return (
    <div>
      <Select
        showSearch
        allowClear={allowClear}
        disabled={disabled}
        loading={loading}
        style={{ width: '100%', ...style }}
        placeholder={placeholder}
        value={value ?? undefined}
        options={options}
        optionFilterProp="label"
        notFoundContent={loading ? '加载中…' : '暂无可选客户'}
        onChange={(next?: string) => onChange?.(next ?? null)}
      />
      {error ? (
        <Text type="danger" style={{ fontSize: 12 }}>
          客户选项加载失败：{error}
        </Text>
      ) : null}
    </div>
  );
}
