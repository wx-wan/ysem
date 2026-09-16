import { Prisma, PrismaClient } from '@prisma/client';

// ============================================================================
// SKU 生成与并发硬化（Round 3C-3-A）
//
// 【背景】Product.sku 为 `String? @unique`（DB 唯一索引 Product_sku_key）。
//   SKU 语义 = `${craftPart}-${audienceCode}-${序号(3 位补零)}`，序号按「数据库当前
//   同 prefix 的 SKU 集合」取 max + 1。它不是业务单号，**不在** NumberSequence 的
//   15 个 code 之内，因此允许 max+1 的生成方式（业务单号走 getNextNumber(tx, code)）。
//
// 【两个真实缺陷】
//   C-1（确定性）：组合/批次写入在事务内循环创建 Product 时，若用**根客户端**扫描 SKU，
//       同一事务先前创建、尚未提交的 Product 对另一条连接的查询不可见 →
//       同一组合内相同 craft-audience 的多个明细必然生成同一个 SKU →
//       第二次 INSERT 命中 P2002 → 整组回滚（无需并发即可触发）。
//   C-2（跨请求）：两个请求并发读到相同的 max → 生成同一个 SKU →
//       DB 唯一索引阻止重复落库（安全边界成立），但后提交者当前返回 500 且
//       透出原始 Prisma 错误消息。
//
// 【修复原则】
//   1) 写入路径一律把**事务客户端 tx** 传进来（事务内可见本事务已写入的行）；
//      预览路径（不落库）继续使用根客户端 `prisma`。
//   2) 跨请求竞争允许 P2002 发生，但必须**有限重试**（重试包住整个事务，
//      因为 SKU 必须在事务内基于数据库当前值重新计算）。
//   3) 绝不做「手工 +1」旁路；max 永远来自数据库当前 SKU 集合。
//   4) DB 唯一索引始终是最终安全边界 —— 绝不允许重复 SKU 落库。
// ============================================================================

/** 最多尝试次数（含首次）。耗尽后仍冲突 → SkuConcurrencyError → HTTP 409。 */
export const SKU_MAX_ATTEMPTS = 3;

/** 并发冲突耗尽重试后的对外文案（不得泄漏 Prisma 内部信息）。 */
export const SKU_CONFLICT_MESSAGE = 'SKU 生成发生并发冲突，请重试';

/**
 * 写入路径可用的最小 DB 依赖面。
 * - 事务内（create / update / 批次 / 组合内快速新建）：传 `tx`
 * - 预览（GET /products/sku-preview，不落库）：传根 `prisma`
 */
export type SkuDatabase = PrismaClient | Prisma.TransactionClient;

/** 工艺/受众缺编码 → 调用方按 400 处理（与既有语义一致，非并发错误）。 */
export class SkuContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkuContextError';
  }
}

/** SKU 唯一冲突重试耗尽 → 调用方按 409 处理。 */
export class SkuConcurrencyError extends Error {
  /** 最后一次 P2002 原始错误（仅用于服务端日志，不对外输出）。 */
  readonly cause?: unknown;
  constructor(message: string = SKU_CONFLICT_MESSAGE, cause?: unknown) {
    super(message);
    this.name = 'SkuConcurrencyError';
    this.cause = cause;
  }
}

/**
 * 按「工艺代码 - 受众代码 - 序号」生成 SKU。
 *
 * 格式（冻结，不得变更）：
 *   · 多工艺：主工艺在括号外，其余用 `+` 连接 → `TJ(ZS)-ET-001`
 *   · 单工艺：`TJ-ET-001`
 *   · 序号：同 prefix 现有 SKU 的 max + 1，3 位补零
 *   · 缺工艺 / 缺受众 / 工艺或受众未配置 code → 返回 null（由调用方决定提示）
 *
 * ⚠️ `db` 必须是**事务客户端**（写入路径），否则同一事务内先前创建的行不可见。
 */
export async function buildSkuCode(
  db: SkuDatabase,
  craftIds: string[],
  audienceId: string | null,
  excludeId?: string,
): Promise<string | null> {
  if (!craftIds.length || !audienceId) return null;
  const crafts = await db.productCraft.findMany({ where: { id: { in: craftIds } } });
  const craftCodes = craftIds
    .map((id) => crafts.find((c) => c.id === id)?.code)
    .filter((c): c is string => Boolean(c));
  if (craftCodes.length !== craftIds.length) return null; // 有工艺未配置 code
  const audience = await db.productAudience.findUnique({ where: { id: audienceId } });
  if (!audience?.code) return null;

  const craftPart = craftCodes.length > 1
    ? `${craftCodes[0]}(${craftCodes.slice(1).join('+')})`
    : craftCodes[0];
  const prefix = `${craftPart}-${audience.code}-`;

  // max 始终取自数据库当前 SKU 集合（事务内经 tx 可见本事务已创建的行）
  const existing = await db.product.findMany({
    where: { sku: { startsWith: prefix }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { sku: true },
  });
  let max = 0;
  for (const p of existing) {
    if (!p.sku) continue;
    const n = Number(p.sku.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

// ============================================================================
// P2002 精确识别（只认 SKU）
// ============================================================================

/**
 * Product.sku 的唯一约束标识集合（精确匹配，避免把其它 unique 误判为 SKU）。
 *
 * Prisma 在不同驱动 / 版本下 `meta.target` 可能是：
 *   · 字段数组：`['sku']`
 *   · 约束名（PG）：`'Product_sku_key'`
 * 两种形态均在此覆盖；**不包含** `ComboProduct_sku_key`（组合 SKU 非本生成器产物）。
 */
const SKU_UNIQUE_TARGETS: readonly string[] = ['sku', 'Product_sku_key', 'products_sku_key'];

/** 归一化 P2002 的 meta.target → 字符串 token 列表 */
function uniqueTargetTokens(error: Prisma.PrismaClientKnownRequestError): string[] {
  const meta = error.meta as { target?: unknown } | undefined;
  const target = meta?.target;
  if (Array.isArray(target)) return target.map((t) => String(t));
  if (typeof target === 'string') {
    // PG 约束名 / `(sku)` / `"sku"` 等形态 → 去除包裹字符后按分隔符切分
    return target.replace(/[()"']/g, ' ').split(/[,\s]+/).filter(Boolean);
  }
  return [];
}

/**
 * 是否为 **Product.sku** 的唯一约束冲突（P2002）。
 *
 * 判定：`code === 'P2002'` 且 `meta.target` 精确命中 SKU 约束标识。
 * 不使用 message 子串匹配（避免误判 Customer / productNo / ComboProduct 等其它 unique）。
 */
export function isSkuUniqueConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== 'P2002') return false;
  return uniqueTargetTokens(error).some((t) => SKU_UNIQUE_TARGETS.includes(t));
}

// ============================================================================
// 有限重试
// ============================================================================

/**
 * 以「整段写入」为粒度做有限 SKU 冲突重试。
 *
 * `run` **必须**是完整的 `prisma.$transaction(...)` 闭包，因为 SKU 需要在事务内
 * 基于数据库当前值重新计算（不能复用上一次生成的结果）。
 *
 * 语义：
 *   · 非 SKU 冲突 → 原样抛出（保持既有 error semantics，由调用方处理）
 *   · SKU 冲突 → 重试至多 {@link SKU_MAX_ATTEMPTS} 次
 *   · 耗尽 → 抛 {@link SkuConcurrencyError}（调用方映射 409）
 */
export async function withSkuRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastConflict: unknown;
  for (let attempt = 1; attempt <= SKU_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isSkuUniqueConflict(error)) throw error;
      lastConflict = error;
    }
  }
  throw new SkuConcurrencyError(SKU_CONFLICT_MESSAGE, lastConflict);
}
