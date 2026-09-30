import { Currency, Prisma } from '@prisma/client';
import { DomainValidationError } from '../lib/errors';
import { dailyExchangeRateRepository, opportunityRepository, userRepository } from '../repositories';
import { BASE_CURRENCY, normalizeRate, toDecimal, type DecimalInput } from '../utils/currency';
import { applyScope } from '../scope';

/**
 * Sales Process Domain · 共享业务上下文（Round R-5 · Phase 1）
 *
 * 存在的理由：Opportunity / Quotation / SampleOrder / SalesOrder 四个业务模块
 * 共用**完全相同的**调用者上下文形状、数据范围口径、汇率解析与「归属人可指派」判定。
 * 若不共享，四个 service 会各自发明一份等价实现（重复业务口径 = 后续不一致的种子）。
 *
 * 边界：本文件只放**跨销售模块共用的业务口径与范围工具**，
 * 不放任何单模块业务规则，也不构成新的一层。
 */

/**
 * 金额入参：JSON number 或 string，一律经 Decimal 归一（禁止 JS number 参与运算）。
 * 注：`resolveExchangeRate` 接受更宽的 `DecimalInput`（含已有 Decimal），
 * 以便财务域直接用已有 Decimal 汇率值调用而不必二次转换。
 */
export type AmountInput = number | string;

/**
 * 销售域调用者上下文：由 Controller 在 HTTP 边界组装。
 * Business / Operation / Data 层**不接触** req / res。
 */
export interface SalesActorContext {
  userId?: string;
  username?: string;
  realName?: string;
  roleCode?: string;
  ip?: string;
  scope: {
    /** 按 ownerId 过滤（roleScope(req, { field: 'ownerId' })）—— 单条读写数据范围门 */
    owner(): Promise<Record<string, unknown>>;
    /** 按目标用户 id 过滤（roleScope(req, { field: 'id' })）——「归属人是否可指派」 */
    assignee(): Promise<Record<string, unknown>>;
    /** 产品可见性条件（productVisibilityWhere(req)） */
    productVisibility(): Record<string, unknown>;
  };
}

/** 「当前用户数据范围 + id」条件（与既有各 controller 的 scopedWhere 逐字同口径） */
export async function salesScopedWhere(
  ctx: SalesActorContext,
  id: string,
): Promise<Record<string, unknown>> {
  return applyScope({ id }, await ctx.scope.owner());
}

/** 归属人可指派校验（既有 D-C4-B Option B 口径；不可指派 → 400 同文案） */
export async function assertAssignableOwner(ctx: SalesActorContext, ownerId: string): Promise<void> {
  const found = await userRepository.findScopedById(ownerId, await ctx.scope.assignee());
  if (!found) throw new DomainValidationError('业务归属人不存在或无权限指派');
}

/**
 * 解析汇率（冻结语义 rateToCny：1 单位原币 = X CNY）。
 *  - 本位币 CNY：恒为 1（定义性汇率，非伪造）
 *  - 其余币种：入参优先，其次取 DailyExchangeRate 最近一期
 *  - 都取不到：返回 null —— 不猜测、不按 1 兜底
 */
export async function resolveExchangeRate(
  currency: Currency,
  input?: DecimalInput | null,
): Promise<Prisma.Decimal | null> {
  if (currency === BASE_CURRENCY) return new Prisma.Decimal(1);
  const normalized = normalizeRate(input ?? null, 'rateToCny');
  if (normalized) return normalized;
  return dailyExchangeRateRepository.findLatestRateAny(currency);
}

/** 可见产品批量读取（商机明细快照用；不可见与不存在同结果） */
export function findVisibleProductNames(
  productIds: string[],
  ctx: SalesActorContext,
): Promise<{ id: string; name: string }[]> {
  return opportunityRepository.findVisibleProductNames(
    productIds,
    ctx.scope.productVisibility() as Prisma.ProductWhereInput,
  );
}
