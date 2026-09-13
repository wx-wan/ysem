import { Currency, Prisma } from '@prisma/client';

/**
 * 金额 / 币种 / 汇率基础工具（V1.0 共享后端基础）
 *
 * 冻结语义（docs 00 ADR-06 / ADR-18）：
 *   amount        原币金额
 *   currency      原币种（Currency 枚举，默认 USD）
 *   exchangeRate  **rateToCny**：1 单位原币 = X CNY
 *   amountCny     = amount × exchangeRate
 *
 * 例：USD 100，1 USD = 7.10 CNY
 *   amount = 100，currency = USD，exchangeRate = 7.10，amountCny = 710.00
 *
 * 禁止：
 *  - 旧 `ratePerCNY` 语义（1 CNY = X 目标币）直接改名字混入新系统 —— 必须用
 *    `normalizeRate(rate, 'perCny')` 显式取倒数归一化。
 *  - 用 Number / parseFloat 参与金额、汇率、比率运算（浮点精度丢失）。
 *    Prisma 的 Decimal 字段读写一律走 `Prisma.Decimal`。
 */

/** 本位币：固定 CNY（全系统记账币种） */
export const BASE_CURRENCY: Currency = Currency.CNY;

/**
 * V1.0 业务目标精度（对齐 docs 00 §金额精度）。
 * ⚠️ 只用于**计算与序列化**的四舍五入口径；不作为修改 Prisma `@db.Decimal` 的依据。
 */
export const DECIMAL_PRECISION = {
  /** 金额 */
  amount: 2,
  /** 单价 */
  unitPrice: 6,
  /** 数量 */
  quantity: 4,
  /** 汇率（对齐 `DailyExchangeRate.rateToCny @db.Decimal(18,8)`） */
  exchangeRate: 8,
  /** 比率（百分数语义，如 12.5 表示 12.5%） */
  ratio: 4,
} as const;

/**
 * 汇率语义方向。
 *  - `rateToCny`：V1.0 标准，1 单位原币 = X CNY，原样使用
 *  - `perCny`：旧 `ratePerCNY` / 外部 API 的 `from=CNY` 响应，1 CNY = X 原币，取倒数归一化
 */
export type RateDirection = 'rateToCny' | 'perCny';

export type DecimalInput =
  | Prisma.Decimal
  | string
  | number
  | null
  | undefined;

/** 安全转 Decimal：非法 / 空 / 非有限值返回 null（由调用方决定兜底策略）。 */
export const toDecimal = (value: DecimalInput): Prisma.Decimal | null => {
  if (value === null || value === undefined || value === '') return null;
  try {
    const decimal =
      value instanceof Prisma.Decimal
        ? value
        : new Prisma.Decimal(value as string | number);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
};

/** 按指定小数位四舍五入（HALF_UP，财务口径）。 */
export const round = (value: DecimalInput, dp: number): Prisma.Decimal | null => {
  const decimal = toDecimal(value);
  if (!decimal) return null;
  return decimal.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
};

/**
 * 归一化汇率为 V1.0 `rateToCny` 语义（1 单位原币 = X CNY）。
 *
 * @param rate      原始汇率
 * @param direction 该汇率的语义方向，默认 'rateToCny'
 *
 * 返回 null 表示汇率非法（空 / 非数字 / 非正数）。
 * 我们**不猜测**方向：调用方必须显式声明 direction，避免用改名掩盖方向错误。
 */
export const normalizeRate = (
  rate: DecimalInput,
  direction: RateDirection = 'rateToCny',
): Prisma.Decimal | null => {
  const decimal = toDecimal(rate);
  if (!decimal || !decimal.gt(0)) return null;

  const rateToCny =
    direction === 'perCny' ? new Prisma.Decimal(1).div(decimal) : decimal;

  return rateToCny.toDecimalPlaces(
    DECIMAL_PRECISION.exchangeRate,
    Prisma.Decimal.ROUND_HALF_UP,
  );
};

/**
 * CNY 本位金额：amountCny = amount × exchangeRate（exchangeRate 必须是 rateToCny 语义）。
 * 汇率非法或缺失时返回 null —— 不允许静默按 1 处理，避免产生错误账面金额。
 */
export const toCny = (
  amount: DecimalInput,
  exchangeRate: DecimalInput,
): Prisma.Decimal | null => {
  const amountDecimal = toDecimal(amount);
  const rateDecimal = toDecimal(exchangeRate);
  if (!amountDecimal || !rateDecimal) return null;

  return amountDecimal
    .times(rateDecimal)
    .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);
};

/** 比率（百分数语义）应用：amount × (ratio / 100)。 */
export const applyRatio = (
  amount: DecimalInput,
  ratioPercent: DecimalInput,
): Prisma.Decimal | null => {
  const amountDecimal = toDecimal(amount);
  const ratioDecimal = toDecimal(ratioPercent);
  if (!amountDecimal || !ratioDecimal) return null;

  return amountDecimal
    .times(ratioDecimal)
    .div(100)
    .toDecimalPlaces(DECIMAL_PRECISION.amount, Prisma.Decimal.ROUND_HALF_UP);
};

/**
 * Decimal → string（API 层统一序列化，避免 JSON number 精度丢失，docs 00 ADR-16）。
 *
 * @param dp 可选小数位；不传则保留 Decimal 自身精度（不补零）
 */
export const serializeDecimal = (
  value: DecimalInput,
  dp?: number,
): string | null => {
  const decimal = toDecimal(value);
  if (!decimal) return null;
  const target =
    dp === undefined
      ? decimal
      : decimal.toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
  return target.toFixed();
};

/** 金额序列化（2 位小数）。 */
export const serializeAmount = (value: DecimalInput): string | null =>
  serializeDecimal(value, DECIMAL_PRECISION.amount);

/** 汇率序列化（8 位小数）。 */
export const serializeRate = (value: DecimalInput): string | null =>
  serializeDecimal(value, DECIMAL_PRECISION.exchangeRate);

/**
 * Decimal → number。
 * ⚠️ 仅用于图表 / 展示等非账务场景；账务累计必须继续用 Decimal。
 */
export const decimalToNumber = (value: DecimalInput): number | null => {
  const decimal = toDecimal(value);
  return decimal ? decimal.toNumber() : null;
};

/**
 * 系统实际支持取汇的币种（V1.0 `Currency` 枚举子集）。
 *
 * - 不含 CNY（本位币，恒为 1，无需取汇）
 * - 不含 RUB —— 无稳定公开汇率源，避免请求外部 API 时被忽略而产生空值
 * - ⚠️ 不得出现 `Currency` 枚举之外的币种：旧实现硬编码的 `CHF` 在 V1.0 枚举中
 *   已不存在，必须删除（不允许为了兼容旧 controller 反向修改 Prisma enum）。
 */
export const QUOTED_CURRENCIES: Currency[] = [
  Currency.USD,
  Currency.EUR,
  Currency.GBP,
  Currency.JPY,
  Currency.KRW,
  Currency.AUD,
  Currency.CAD,
];

const QUOTED_CURRENCY_SET = new Set<string>(QUOTED_CURRENCIES);

/** 类型守卫：字符串是否为受支持的取汇币种。 */
export const isQuotedCurrency = (code: string): code is Currency =>
  QUOTED_CURRENCY_SET.has(code);
