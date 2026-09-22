import { Select, Typography } from 'antd';
import type { CSSProperties } from 'react';
import { useEffect, useMemo } from 'react';
import { useMasterData } from '../../hooks/useMasterData';

const { Text } = Typography;

export interface ProductSelectProps {
  /** 受控值 = Product.id（可直接作为 antd Form.Item 的子组件使用） */
  value?: string | null;
  onChange?: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  allowClear?: boolean;
  style?: CSSProperties;
  /**
   * 当前值兜底（例如编辑历史数据时该产品已不可见 / 已删除）：
   * 仅用于**保留显示**，不会放宽后端可见性，也不会把不可选项变成可选。
   */
  fallbackOption?: { id: string; name: string; sku?: string | null } | null;
}

/**
 * 可复用 Product Select（Round F-S1 §4.4）
 *
 * 数据来源（**零新增端点、零重复封装**）：
 *   GET /api/products/options（select { id, name, sku }）
 *   → api/masterData.getProductOptions() → master data store（TTL 缓存 + 会话隔离 + in-flight 去重）
 *   → useMasterData().productOptions
 *
 * 后端语义（**不得放宽**）：admin 可选全部；非 admin 仅可选
 * PUBLIC ∨（PRIVATE ∧ 本人创建）∨（PRIVATE ∧ 在可见人名单）的产品。
 *
 * 设计边界：
 *   · 只负责「选一个真实 Product」，不携带价格/数量等报价语义（那些属商机/报价明细）；
 *   · 不发任何写请求；不缓存于组件外部（缓存在 master data store，受 TTL 约束）。
 */
export default function ProductSelect({
  value,
  onChange,
  disabled,
  placeholder = '选择产品',
  allowClear = true,
  style,
  fallbackOption,
}: ProductSelectProps) {
  const { productOptions, loadProductOptions, status } = useMasterData();
  const { loading, error } = status.productOptions;

  // 挂载即确保字典就绪（TTL 内不重复请求；失败不阻塞表单 —— 保持空态并提示）
  useEffect(() => {
    void loadProductOptions().catch(() => {
      /* 由下方 error 提示呈现，不抛出 */
    });
  }, [loadProductOptions]);

  const options = useMemo(() => {
    const list = productOptions.map((option) => ({
      label: option.sku ? `${option.name}（${option.sku}）` : option.name,
      value: option.id,
    }));
    // 历史值兜底：仅当当前值不在可选集合中时追加（不改变后端可见性语义）
    if (fallbackOption && !list.some((option) => option.value === fallbackOption.id)) {
      const suffix = fallbackOption.sku ? `（${fallbackOption.sku}）` : '';
      list.unshift({ label: `${fallbackOption.name}${suffix}（当前值，不在可选列表中）`, value: fallbackOption.id });
    }
    return list;
  }, [productOptions, fallbackOption]);

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
        notFoundContent={loading ? '加载中…' : '暂无可选产品'}
        onChange={(next?: string) => onChange?.(next ?? null)}
      />
      {error ? (
        <Text type="danger" style={{ fontSize: 12 }}>
          产品选项加载失败：{error}
        </Text>
      ) : null}
    </div>
  );
}
