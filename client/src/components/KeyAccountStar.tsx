import { StarFilled, StarOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { customerApi } from '../api/customers';

interface KeyAccountStarProps {
  isKeyAccount: boolean;
  customerId?: string;
  onToggle?: () => void;
  size?: number;
  color?: string;
  mutedColor?: string;
}

// 光晕脉冲动画
const glowVariants: Variants = {
  active: {
    scale: [1, 1.35, 1],
    opacity: [0.35, 0.6, 0.35],
    transition: {
      duration: 2.2,
      repeat: Infinity,
      ease: 'easeInOut',
    } as const,
  },
  idle: { scale: 1, opacity: 0 },
};

// 粒子旋转动画
const sparkleVariants: Variants = {
  animate: (i: number) => ({
    rotate: [i * 72, 360 + i * 72],
    opacity: [0, 0.8, 0],
    scale: [0.3, 1, 0.3],
    transition: {
      duration: 2 + i * 0.3,
      repeat: Infinity,
      ease: 'easeInOut',
      delay: i * 0.3,
    } as const,
  }),
};

// 星星主体动画
const starButtonVariants: Variants = {
  hover: { scale: 1.2, transition: { type: 'spring', stiffness: 400, damping: 10 } as const },
  tap: { scale: 0.85, transition: { type: 'spring', stiffness: 600, damping: 12 } as const },
  idle: { scale: 1 },
};

// 激活时的弹跳入场
const activeAppear: Variants = {
  initial: { scale: 0, rotate: -90 },
  animate: {
    scale: 1,
    rotate: 0,
    transition: { type: 'spring', stiffness: 300, damping: 12, duration: 0.5 } as const,
  },
  exit: { scale: 0, rotate: 90, transition: { duration: 0.2 } },
};

export default function KeyAccountStar({
  isKeyAccount,
  customerId,
  onToggle,
  size = 20,
  color = '#faad14',
  mutedColor = '#bfbfbf',
}: KeyAccountStarProps) {
  const [loading, setLoading] = useState(false);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (loading) return;
    if (!customerId) {
      onToggle?.();
      return;
    }
    setLoading(true);
    try {
      await customerApi.update(customerId, { isKeyAccount: !isKeyAccount } as any);
      onToggle?.();
    } catch {
      // 静默失败，不弹提示框
    } finally {
      setLoading(false);
    }
  };

  const glowSize = size * 2.2;
  // 生成 5 个粒子，均匀分布
  const sparkleCount = 5;

  return (
      <motion.span
        onClick={handleToggle}
        style={{
          cursor: 'pointer',
          fontSize: size,
          lineHeight: 1,
          opacity: loading ? 0.5 : 1,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: glowSize,
          height: glowSize,
        }}
        variants={starButtonVariants}
        whileHover="hover"
        whileTap="tap"
        initial="idle"
        animate={isKeyAccount ? 'active' : 'idle'}
      >
        {/* 脉冲光晕 — 仅重点客户时显示 */}
        <AnimatePresence>
          {isKeyAccount && (
            <motion.span
              key="glow"
              initial={{ scale: 0.8, opacity: 0 }}
              animate="active"
              exit={{ scale: 0.8, opacity: 0, transition: { duration: 0.2 } }}
              variants={glowVariants}
              style={{
                position: 'absolute',
                width: glowSize,
                height: glowSize,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${color}44 0%, ${color}11 60%, transparent 70%)`,
                pointerEvents: 'none',
              }}
            />
          )}
        </AnimatePresence>

        {/* 旋转粒子 — 仅重点客户时显示 */}
        <AnimatePresence>
          {isKeyAccount &&
            Array.from({ length: sparkleCount }).map((_, i) => (
              <motion.span
                key={`sparkle-${i}`}
                custom={i}
                variants={sparkleVariants}
                initial="animate"
                animate="animate"
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                style={{
                  position: 'absolute',
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  backgroundColor: color,
                  pointerEvents: 'none',
                  transformOrigin: `0 ${glowSize / 2}px`,
                  left: '50%',
                  top: 0,
                }}
              />
            ))}
        </AnimatePresence>

        {/* 星星主体 */}
        <AnimatePresence mode="wait">
          {isKeyAccount ? (
            <motion.span
              key="filled"
              variants={activeAppear}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ display: 'inline-flex', position: 'relative', zIndex: 1 }}
            >
              <StarFilled style={{ color, filter: `drop-shadow(0 0 ${size * 0.2}px ${color}88)` }} />
            </motion.span>
          ) : (
            <motion.span
              key="outlined"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 15 } }}
              exit={{ scale: 0, opacity: 0, transition: { duration: 0.15 } }}
              style={{ display: 'inline-flex', position: 'relative', zIndex: 1 }}
            >
              <StarOutlined style={{ color: mutedColor }} />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
  );
}
