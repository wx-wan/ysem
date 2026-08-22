import React from 'react';

interface Option<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  value: T;
  options: Option<T>[];
  onChange: (key: T) => void;
}

// 胶囊切换按钮（仿客户页「公海/重点」），内联不占满整行
export default function CapsuleSwitch<T extends string>({ value, options, onChange }: Props<T>) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#f1f5f9', borderRadius: 24, padding: '3px 4px' }}>
      {options.map((opt) => {
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            style={{
              border: 'none', outline: 'none', cursor: 'pointer',
              padding: '5px 18px', borderRadius: 20, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
              transition: 'all 0.25s ease',
              background: active ? '#1677ff' : 'transparent',
              color: active ? '#fff' : '#64748b',
              boxShadow: active ? '0 2px 8px rgba(22,119,255,0.3)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
