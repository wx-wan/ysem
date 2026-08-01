import { useMemo } from 'react';

/**
 * 金色星光闪烁 — 纯 CSS 动效，无 JS 驱动，GPU 加速
 */
const PARTICLE_COUNT = 5;

export default function CustomerCardSparkle() {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
        id: i,
        left: `${5 + Math.random() * 90}%`,
        top: `${5 + Math.random() * 50}%`,
        animationDelay: `${Math.random() * 3}s`,
        animationDuration: `${2 + Math.random() * 1.5}s`,
        size: 4 + Math.random() * 5,
      })),
    [],
  );

  return (
    <div className="sparkle-container" aria-hidden="true">
      {particles.map((p) => (
        <div
          key={p.id}
          className="sparkle-particle"
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animationDelay: p.animationDelay,
            animationDuration: p.animationDuration,
          }}
        />
      ))}
    </div>
  );
}
