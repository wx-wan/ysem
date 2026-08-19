import { theme } from 'antd';

export interface FilterCapsuleOption<T extends string = string> {
  key: T;
  label: string;
  /** 右侧计数角标（可选） */
  count?: number;
}

interface FilterCapsulesProps<T extends string = string> {
  options: FilterCapsuleOption<T>[];
  value: T;
  onChange: (key: T) => void;
  /** 风格：primary 主筛选（胶囊底，active 实心主色）；sub 子筛选（浅底，active 主色浅底） */
  tone?: 'primary' | 'sub';
  /** 窄屏横向滚动（默认 true） */
  scrollable?: boolean;
}

/**
 * 通用胶囊筛选组：主/子筛选共用。
 * 页面框架组件，供客户 / 产品等列表页复用。
 */
export default function FilterCapsules<T extends string = string>({
  options,
  value,
  onChange,
  tone = 'primary',
  scrollable = true,
}: FilterCapsulesProps<T>) {
  const { token } = theme.useToken();
  const radiusPill = 999;
  const active = tone === 'primary';
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: active ? token.colorFillQuaternary : token.colorFillTertiary,
        borderRadius: radiusPill,
        padding: '3px 4px',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: scrollable ? 'auto' : 'visible',
        msOverflowStyle: 'none',
        scrollbarWidth: 'none',
      }}
    >
      {options.map((opt) => {
        const isActive = value === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              border: 'none',
              outline: 'none',
              cursor: 'pointer',
              padding: active ? '5px 12px' : '4px 10px',
              borderRadius: active ? radiusPill : token.borderRadius,
              fontSize: active ? 13 : 12,
              fontWeight: isActive ? 600 : active ? 600 : 500,
              whiteSpace: 'nowrap',
              transition: 'all 0.25s ease',
              flexShrink: 0,
              background: isActive
                ? active ? token.colorPrimary : token.colorPrimaryBg
                : 'transparent',
              color: isActive
                ? active ? '#fff' : token.colorPrimary
                : active ? token.colorTextSecondary : token.colorTextTertiary,
              boxShadow: isActive && active ? `0 2px 8px ${token.colorPrimaryBg}` : 'none',
            }}
          >
            {opt.label}
            {typeof opt.count === 'number' && (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 6px',
                  borderRadius: 10,
                  background: isActive ? token.colorPrimary : token.colorFillQuaternary,
                  color: isActive ? token.colorWhite : token.colorTextTertiary,
                  lineHeight: '16px',
                }}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
