import { Prisma } from '@prisma/client';

/**
 * V1.0 原子编号基础设施（NumberSequence Runtime）。
 *
 * 格式权威来源
 * ------------
 * 15 个 code 的 `prefix` / `datePattern` / `padding` 的**唯一权威来源是数据库
 * NumberSequence 表**（由 Round 3B-3-4-0A 冻结的 seed 配置写入）。
 * 本文件**不硬编码**任何 `code → 格式` 映射，避免与 seed 形成双源漂移。
 *
 * 并发安全
 * --------
 * 同一 code 的并发分配由**单条 `UPDATE ... RETURNING`** 配合 PostgreSQL 行级锁
 * 串行化：读-改-写全部发生在数据库端一条语句内，不存在应用层 TOCTOU 窗口。
 * 禁止任何 `MAX(number) + 1` / `COUNT(*) + 1` / `findUnique → update` 变体。
 *
 * 事务边界
 * --------
 * `getNextNumber` **必须**由调用方在 `prisma.$transaction(...)` 内调用并传入 `tx`：
 *
 * ```ts
 * const item = await prisma.$transaction(async (tx) => {
 *   const orderNo = await getNextNumber(tx, 'SO');
 *   return tx.salesOrder.create({ data: { orderNo, ... } });
 * });
 * ```
 *
 * 本模块**永不**自建事务（内部若调用 `prisma.$transaction` 会切断与业务写入的原子性）。
 * 同事务执行带来的性质：业务写入失败 → 计数一并回滚 → **不产生编号空洞**。
 */

/** 冻结的 15 个业务序列 code（与 NumberSequence seed 冻结表一一对应） */
export const SEQ_CODES = [
  'LEAD',
  'OPP',
  'QUO',
  'SMP',
  'SO',
  'PO',
  'PR',
  'SHP',
  'INS',
  'PAY',
  'PRF',
  'CUS',
  'PRD',
  'SUP',
  'CMB',
] as const;

export type SeqCode = (typeof SEQ_CODES)[number];

/** 冻结业务时区：编号周期必须基于此刻计算，禁止依赖服务器本地时区 */
export const BUSINESS_TIMEZONE = 'Asia/Shanghai';

/** 支持的 datePattern；其他取值一律报错，不做静默 fallback */
const SUPPORTED_DATE_PATTERNS = ['yyyyMMdd', 'yyyyMM'] as const;

/** 编号配置类错误（序列行缺失 / code 非法 / datePattern 非法 / padding 非法） */
export class NumberSequenceConfigError extends Error {
  /** 关联的 sequence code（无法确定时为 null） */
  readonly seqCode: string | null;

  constructor(message: string, seqCode: string | null = null) {
    super(message);
    this.name = 'NumberSequenceConfigError';
    this.seqCode = seqCode;
  }
}

const isSeqCode = (value: string): value is SeqCode =>
  (SEQ_CODES as readonly string[]).includes(value);

const isSupportedDatePattern = (value: string): boolean =>
  (SUPPORTED_DATE_PATTERNS as readonly string[]).includes(value);

/** Asia/Shanghai 日历分量格式化器（用 formatToParts，避免依赖 locale 输出格式） */
const shanghaiCalendarFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * 按 datePattern 计算周期键（基准时区 = Asia/Shanghai）。
 *
 * - `yyyyMMdd` → `20260914`
 * - `yyyyMM`   → `202609`
 * - 其他        → 抛 NumberSequenceConfigError（禁止静默 fallback）
 *
 * @param seqCode 可选，仅用于让错误信息携带 sequence 上下文
 */
export function resolvePeriod(datePattern: string, at: Date = new Date(), seqCode?: string): string {
  if (!isSupportedDatePattern(datePattern)) {
    throw new NumberSequenceConfigError(
      `Unsupported NumberSequence datePattern: "${datePattern}"`,
      seqCode ?? null,
    );
  }

  const parts = shanghaiCalendarFormatter.formatToParts(at);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new NumberSequenceConfigError(
      `Unable to resolve period in ${BUSINESS_TIMEZONE} for datePattern "${datePattern}"`,
      seqCode ?? null,
    );
  }

  return datePattern === 'yyyyMM' ? `${year}${month}` : `${year}${month}${day}`;
}

/**
 * 组装最终编号：`${prefix}-${period}-${value 左补零}`。
 *
 * `padding` 是**最小宽度**：超过 9999 时自然溢出为更多位数（如 `10000`），不报错。
 */
export function formatNumber(
  prefix: string,
  period: string,
  value: number,
  padding: number,
): string {
  if (!Number.isInteger(padding) || padding <= 0) {
    throw new NumberSequenceConfigError(`Invalid NumberSequence padding: ${String(padding)}`);
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new NumberSequenceConfigError(`Invalid NumberSequence currentValue: ${String(value)}`);
  }
  return `${prefix}-${period}-${String(value).padStart(padding, '0')}`;
}

/** NumberSequence 配置行（第 1 步读取） */
interface SequenceConfigRow {
  datePattern: string;
  padding: number;
}

/** 原子分配结果行（第 2 步 RETURNING） */
interface SequenceAllocationRow {
  prefix: string;
  currentValue: number;
  padding: number;
}

/**
 * 原子分配下一个业务编号。
 *
 * 必须在调用方事务内执行（传入 `tx`），与业务写入同事务。
 *
 * 流程（两步，均在同一个 `tx` 内）：
 *  1. 读取该 code 的 `datePattern` / `padding`（判定周期所需；非法配置在此提前失败）
 *  2. 单条 `UPDATE ... RETURNING` 完成：周期判定 + 归零 / 递增 + `version` 递增
 *
 * 并发语义（PostgreSQL READ COMMITTED）：
 * 并发 UPDATE 同一行时后到者阻塞在行锁上，锁释放后会基于**最新行版本**重新求值
 * `CASE`，因此递增是叠加的 —— A→0001、B→0002、C→0003，不重复、不丢号。
 *
 * @throws NumberSequenceConfigError code 非法 / 序列行缺失 / datePattern 非法 / padding 非法
 */
export async function getNextNumber(
  tx: Prisma.TransactionClient,
  code: SeqCode,
  at: Date = new Date(),
): Promise<string> {
  if (!isSeqCode(code)) {
    throw new NumberSequenceConfigError(`Unknown NumberSequence code: ${String(code)}`);
  }

  // 步骤 1：读取配置（同一事务）。此步不加锁，真正的原子性由步骤 2 的单条 UPDATE 保证。
  const configs = await tx.$queryRaw<SequenceConfigRow[]>`
    SELECT "datePattern", "padding"
    FROM "NumberSequence"
    WHERE "code" = ${code}
    LIMIT 1
  `;

  const config = configs[0];
  if (!config) {
    throw new NumberSequenceConfigError(
      `NumberSequence configuration not found: ${code}`,
      code,
    );
  }
  if (!Number.isInteger(config.padding) || config.padding <= 0) {
    throw new NumberSequenceConfigError(
      `Invalid NumberSequence padding for ${code}: ${String(config.padding)}`,
      code,
    );
  }

  const period = resolvePeriod(config.datePattern, at, code);

  // 步骤 2：原子分配。周期切换与递增必须在同一条语句内完成。
  const allocations = await tx.$queryRaw<SequenceAllocationRow[]>`
    UPDATE "NumberSequence"
    SET "currentValue" = CASE
          WHEN "currentPeriod" = ${period} THEN "currentValue" + 1
          ELSE 1
        END,
        "currentPeriod" = ${period},
        "version" = "version" + 1,
        "updatedAt" = NOW()
    WHERE "code" = ${code}
    RETURNING "prefix", "currentValue", "padding"
  `;

  const row = allocations[0];
  if (!row) {
    // 步骤 1 命中的行在步骤 2 消失（并发删除配置）——同样属于配置错误，不自愈
    throw new NumberSequenceConfigError(
      `NumberSequence configuration not found: ${code}`,
      code,
    );
  }
  if (!Number.isInteger(row.currentValue) || row.currentValue <= 0) {
    throw new NumberSequenceConfigError(
      `Invalid NumberSequence currentValue for ${code}: ${String(row.currentValue)}`,
      code,
    );
  }
  if (!Number.isInteger(row.padding) || row.padding <= 0) {
    throw new NumberSequenceConfigError(
      `Invalid NumberSequence padding for ${code}: ${String(row.padding)}`,
      code,
    );
  }

  return formatNumber(row.prefix, period, row.currentValue, row.padding);
}
