/**
 * 展示层格式化（Round F-6）
 *
 * 规则：
 *   · **不在 API 层转换数据类型**（F-5：Decimal → string、DateTime → ISO string 保持原样）；
 *     本文件只服务于 presentation，所有函数对空值/非法值都返回 '-'，绝不输出 undefined / null / NaN。
 *   · 本文件不用于排序（分页排序由后端负责）。
 */

const DASH = '-';

/** 是否为空值（null / undefined / 空串 / 纯空白） */
export const isEmptyValue = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** 文本展示：空值统一 '-' */
export const textOrDash = (value: string | null | undefined): string =>
  isEmptyValue(value) ? DASH : String(value);

/** 日期展示：ISO string → 'YYYY-MM-DD'（含时间时为 'YYYY-MM-DD HH:mm'）；非法/空 → '-' */
export const formatDate = (iso: string | null | undefined, withTime = false): string => {
  if (isEmptyValue(iso)) return DASH;
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return DASH;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ymd;
};

/**
 * 数值金额展示（仅接受 number —— 后端聚合字段已由 Number() 转换）。
 * 注意：**不**对 Decimal-string 做 Number() 转换（F-5 规则）。
 */
export const formatAmount = (value: number | null | undefined, digits = 2): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

/** 日期时间展示（'YYYY-MM-DD HH:mm'）—— 与 formatDate 同一实现，语义更明确 */
export const formatDateTime = (iso: string | null | undefined): string => formatDate(iso, true);

/**
 * Decimal-string 展示（F-5：Decimal → JSON string，如 '1200.0000'）。
 *
 * 规则：**不做 Number() / parseFloat() 转换**（避免精度损失），只做纯字符串规整：
 *   · 去掉小数末尾多余的 0 与孤立小数点（'1200.0000' → '1200'，'1.5000' → '1.5'）；
 *   · 空值 / 非字符串 → '-'；
 *   · 负数、千分位等一律保持原样，不做数值解析。
 */
export const formatDecimalString = (value: string | null | undefined): string => {
  if (isEmptyValue(value)) return DASH;
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw; // 非纯数字形态：原样显示，不猜测
  if (!raw.includes('.')) return raw;
  return raw.replace(/0+$/, '').replace(/\.$/, '');
};
