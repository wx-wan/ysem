import { useState, type ReactNode } from 'react';
import { Button, ConfigProvider, Input, Select, theme } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import ExpandChevron from './ExpandChevron';
import { useTranslation } from 'react-i18next';

/** 筛选组选项（key 为空字符串时表示「全部」） */
export interface FilterGroupOption {
  key: string;
  label: ReactNode;
  /** 选项前缀节点（如成员头像） */
  avatar?: ReactNode;
  /** 选项右侧计数角标（可选，如各子筛选条数） */
  count?: number;
}

interface FilterGroupProps {
  label: ReactNode;
  /** 胶囊选项；与 children 二选一 */
  options?: FilterGroupOption[];
  value?: string;
  onChange?: (key: string) => void;
  /** 自定义控件（如下拉选择、标签选择器）；传入时替代胶囊选项 */
  children?: ReactNode;
}

/**
 * 筛选面板中的一组条件：标签 + 胶囊选项（可带头像前缀）。
 * 选项为下拉等非胶囊控件时，改用 children 传入自定义控件。
 * 供父组件拼装后传入 FilterToolbar 的 children。
 */
export function FilterGroup({ label, options, value, onChange, children }: FilterGroupProps) {
  const { token } = theme.useToken();

  return (
    <div style={{ minWidth: 240 }}>
      <div style={{ fontSize: 13, color: token.colorTextSecondary, marginBottom: 10 }}>{label}</div>
      {children ?? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(options ?? []).map((opt) => {
            const active = (value ?? '') === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChange?.(opt.key)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 8,
                  border: `1px solid ${active ? token.colorPrimary : token.colorBorder}`,
                  background: active ? token.colorPrimary : token.colorBgContainer,
                  color: active ? '#fff' : token.colorText,
                  fontSize: 13,
                  cursor: 'pointer',
                  transition: 'all .2s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                {opt.avatar}
                {opt.label}
                {typeof opt.count === 'number' && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      lineHeight: '16px',
                      padding: '1px 6px',
                      borderRadius: 10,
                      background: active ? 'rgba(255,255,255,0.24)' : token.colorFillSecondary,
                      color: active ? '#fff' : token.colorTextSecondary,
                    }}
                  >
                    {opt.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface FilterToolbarProps {
  /** 搜索框占位文案 */
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (v: string) => void;
  /** 回车提交（可选；不传则为输入即筛） */
  onSearchSubmit?: () => void;
  /** 排序下拉（可选；不传则不渲染） */
  sortOptions?: { value: string; label: ReactNode }[];
  sortValue?: string;
  onSortChange?: (v: string) => void;
  /** 激活筛选条件数量：>0 时「筛选」按钮带角标、第二行出现「清除筛选」 */
  activeCount?: number;
  onClear?: () => void;
  /** 第二行左侧内容（如「私有/公海」范围切换胶囊） */
  tabs?: ReactNode;
  /** 结果总数（显示「共 N 条结果」） */
  total?: number;
  /** 第一行右侧操作区（如「新建线索」主按钮 / 批量删除），渲染在排序之后 */
  actions?: ReactNode;
  /** 点击「筛选」展开的面板内容：父组件传入的筛选条件（配合 FilterGroup 使用） */
  children?: ReactNode;
}

/**
 * 通用交互式筛选栏（参考询盘列表交互）：
 * 第一行 = 搜索 + 「筛选」展开按钮（带激活数角标）+ 排序 + 自定义操作；
 * 第二行 = 范围切换（tabs）+ 结果数 + 清除筛选；
 * 点击「筛选」展开父组件传入的筛选条件面板。
 */
export default function FilterToolbar({
  searchPlaceholder,
  searchValue,
  onSearchChange,
  onSearchSubmit,
  sortOptions,
  sortValue,
  onSortChange,
  activeCount = 0,
  onClear,
  tabs,
  total,
  actions,
  children,
}: FilterToolbarProps) {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);

  return (
    // 筛选栏内所有输入类控件（Input / Select / Button）的高度统一收口在此，
    // 页面侧不再各自覆盖 height / borderRadius —— 圆角沿用全站主题 token（ConfigProvider 全局值）。
    <ConfigProvider theme={{ token: { controlHeight: 40 } }}>
      {/* 第一行：搜索 + 筛选 + 排序 + 操作 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onPressEnter={onSearchSubmit}
          style={{ flex: '1 1 240px', minWidth: 200 }}
        />
        <div style={{ display: 'inline-flex', gap: 12, alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
          <Button onClick={() => setExpanded((v) => !v)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t('common.filter')}
              {activeCount > 0 && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 16,
                    height: 16,
                    padding: '0 4px',
                    borderRadius: 8,
                    background: token.colorPrimary,
                    color: '#fff',
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  {activeCount}
                </span>
              )}
              <ExpandChevron expanded={expanded} size={10} color={token.colorTextSecondary} />
            </span>
          </Button>
          {sortOptions?.length ? (
            sortOptions.length === 2 ? (
              <Button
                onClick={() => {
                  const idx = sortOptions.findIndex((o) => o.value === sortValue);
                  const next = sortOptions[(idx + 1) % sortOptions.length];
                  onSortChange?.(next.value);
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {sortOptions.find((o) => o.value === sortValue)?.label ?? sortOptions[0].label}
                  <ExpandChevron
                    expanded={String(sortValue).includes(':asc')}
                    size={10}
                    color={token.colorTextSecondary}
                  />
                </span>
              </Button>
            ) : (
              <Select style={{ width: 176 }} value={sortValue} onChange={onSortChange} options={sortOptions} />
            )
          ) : null}
          <span>{actions}</span>
        </div>
      </div>

      {/* 第二行：范围切换 + 结果数 + 清除筛选 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginTop: 14,
        }}
      >
        {tabs}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 16, marginLeft: 'auto' }}>
          {typeof total === 'number' && (
            <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
              {t('common.resultCount', { n: total })}
            </span>
          )}
          {activeCount > 0 && onClear && (
            <Button
              type="link"
              size="small"
              style={{ padding: 0, height: 'auto', fontSize: 13 }}
              onClick={onClear}
            >
              {t('common.clearFilters')}
            </Button>
          )}
        </div>
      </div>

      {/* 展开面板：父组件传入的筛选条件 */}
      {expanded && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: `1px dashed ${token.colorBorderSecondary}`,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '16px 56px',
          }}
        >
          {children}
        </div>
      )}
    </ConfigProvider>
  );
}
