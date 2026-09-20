import type { AuthRequest } from '../middleware/auth';
import { getDepartmentScopeUserIds } from './deptTree';

/**
 * 数据范围（Data Scope）通用工具 — V1.0
 *
 * 系统按当前登录用户【角色】的数据范围（Role.dataScope）控制可见数据，共三档：
 *  - ALL   全部数据：不加 owner 条件（管理员恒为全部，由 isAdmin 放行）
 *  - DEPT  本部门及下级部门：**递归**包含全部下级部门成员负责的数据
 *  - SELF  仅本人数据：ownerId === 当前用户
 *
 * 【权限字段唯一】
 * 归属统一使用 `ownerId`。**不得**使用 `createdBy`（审计字段）或旧 `assignedTo`
 * 作为权限字段。`createdBy` 只用于留痕，不参与可见性判定。
 *
 * 【公海（Public Sea）】
 * 公海 = 负责人字段为 null。公海**不是**全局 Scope：
 *  - 只允许 Customer / Lead / Opportunity 三类资源使用；
 *  - 必须由调用方显式调用 `publicSeaScope()` 或 `includePublicSea()` 主动并入；
 *  - **禁止**在 Product / Quotation / SalesOrder / PurchaseOrder / Payment / Profit
 *    等资源上注入公海条件（这些资源不存在「无主公开」语义）。
 *
 * 【已知缺口（claim protection）】
 * 公海认领保护窗口（认领后一段时间内他人不可见/不可重复认领）依赖 Claim/Release 模型，
 * 当前 Lead / Customer 仅以 `ownerId` 表达归属，**尚无保护窗口字段**。
 * 本轮只建立正确的 Scope 边界，保护窗口留待后续（不得为此新增第二套 Claim 体系）。
 *
 * 支持嵌套关联字段（如订单的负责人在 customer.ownerId，传 relation: 'customer'）。
 */

export type DataScope = 'ALL' | 'DEPT' | 'SELF';

export const DATA_SCOPES: DataScope[] = ['ALL', 'DEPT', 'SELF'];

export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  ALL: '全部数据',
  DEPT: '本部门及下级部门',
  SELF: '仅本人数据',
};

export const DEFAULT_DATA_SCOPE: DataScope = 'SELF';

export const isAdmin = (req: AuthRequest): boolean =>
  req.roleCode === 'admin' || req.roleCode === 'ADMIN';

export interface ScopeOptions {
  /** 负责人字段名，默认 'ownerId' */
  field?: string;
  /** 嵌套关联字段（如订单负责人挂在 customer.ownerId，传 'customer'） */
  relation?: string;
}

/**
 * 生成「角色可见范围」条件（异步：DEPT 档位需查询本部门及下级部门成员）。
 *
 * 规则：
 * - 管理员 / dataScope=ALL：返回 {}（不加 owner 条件）
 * - DEPT：本部门 **及全部下级部门** 成员负责的数据（无部门时退化为本人）
 * - SELF：本人负责的数据
 *
 * 注意：本函数**不**包含公海。需要公海语义的资源请显式调用 `includePublicSea()`。
 */
export const roleScope = async (
  req: AuthRequest,
  options: ScopeOptions = {},
): Promise<Record<string, unknown>> => {
  const field = options.field ?? 'ownerId';
  const relation = options.relation;

  if (isAdmin(req)) return {};
  const uid = req.userId;
  if (!uid) return {};

  const scope = (req.dataScope as DataScope) || DEFAULT_DATA_SCOPE;
  let inner: Record<string, unknown>;

  switch (scope) {
    case 'ALL':
      return {};
    case 'DEPT': {
      const ownerIds = await getDepartmentScopeUserIds(uid);
      inner = { [field]: { in: ownerIds } };
      break;
    }
    case 'SELF':
    default:
      inner = { [field]: uid };
  }

  return relation ? { [relation]: inner } : inner;
};

/**
 * 公海范围条件：仅返回负责人为 null 的数据。
 *
 * ⚠️ 仅 Customer / Lead / Opportunity 三类资源允许使用。
 */
export const publicSeaScope = (field = 'ownerId'): Record<string, unknown> => ({
  [field]: null,
});

/**
 * 在角色范围上并入「公海」可见条件（OR 语义）。
 *
 * ⚠️ 仅 Customer / Lead / Opportunity 三类资源允许调用。
 * ALL 档位本身不限制（scope 为空对象），公海天然可见，直接原样返回。
 *
 * @param scope   roleScope 的返回值
 * @param options 必须与生成 scope 时的 field / relation 保持一致
 */
export const includePublicSea = (
  scope: Record<string, unknown>,
  options: ScopeOptions = {},
): Record<string, unknown> => {
  if (!scope || Object.keys(scope).length === 0) return scope ?? {};
  const field = options.field ?? 'ownerId';
  const relation = options.relation;
  const publicSea = relation
    ? { [relation]: { [field]: null } }
    : { [field]: null };
  return { OR: [scope, publicSea] };
};

/**
 * 将范围条件合并进已有的 where（AND 形式）。
 */
export const applyScope = (
  where: Record<string, unknown>,
  scope: Record<string, unknown>,
): Record<string, unknown> => {
  if (!scope || Object.keys(scope).length === 0) return where;
  if (where.AND) {
    return { ...where, AND: [...(where.AND as unknown[]), scope] };
  }
  return { ...where, AND: [scope] };
};

/* ============================================================
 * Product 可见性授权（DQ-3=C：**对象级**授权）
 *
 * 语义与 product.controller 既有四处实现**完全等价**（getProducts / getProductOptions /
 * getProductById / getMixedProducts 的 PRODUCT 分支）：
 *   Product 可见 ⟺ visibility !== 'PRIVATE'
 *               OR createdBy === caller
 *               OR caller ∈ visibleUsers
 *               OR caller 为 admin（roleCode admin|ADMIN）
 *
 * 说明：
 *  - 管理员判据**严格**沿用 `isAdmin`（roleCode），**不**使用 dataScope === 'ALL'；
 *  - 本组 helper 只抽取既有语义，不改变 Product 权限模型，也不涉及 ownerId 数据范围。
 * ============================================================ */

/** 引用侧：可注入 Prisma `where` 的可见性条件（admin / 无 uid ⇒ 无约束，返回 {}） */
export const productVisibilityWhere = (req: AuthRequest): Record<string, unknown> => {
  if (isAdmin(req)) return {};
  const uid = req.userId;
  if (!uid) return {};
  return {
    OR: [
      { visibility: 'PUBLIC' },
      { AND: [{ visibility: 'PRIVATE' }, { createdBy: uid }] },
      { AND: [{ visibility: 'PRIVATE' }, { visibleUsers: { some: { userId: uid } } }] },
    ],
  };
};

/** 读取侧判定所需的 Product 形态（必须由调用方在 select 中显式取回） */
export interface ProductVisibilityShape {
  visibility?: string | null;
  createdBy?: string | null;
  visibleUsers?: { userId: string }[] | null;
}

/**
 * 读取侧：单对象可见性判定（post-filter 用）。
 *
 * ⚠️ **fail-closed**：若调用方未 select `visibility`（字段缺失），视为不可见——
 *    防止「忘记补 select」导致过滤静默失效。调用方必须 select visibility / createdBy / visibleUsers。
 */
export const canReadProduct = (
  req: AuthRequest,
  product: ProductVisibilityShape | null | undefined,
): boolean => {
  if (!product) return false;
  if (isAdmin(req)) return true;
  const uid = req.userId;
  if (!uid) return true;
  if (product.visibility === undefined || product.visibility === null) return false;
  if (product.visibility !== 'PRIVATE') return true;
  if (product.createdBy === uid) return true;
  return (product.visibleUsers ?? []).some((v) => v.userId === uid);
};

/**
 * 读取侧投影：对「带 `product` 关联（+ 可选 `productId` / `productName` 快照）」的单行做可见性投影。
 *
 *  - 关联产品**不可见** ⇒ `product = null`；且当 `productId != null` 时，快照字段
 *    （`options.nameField`，如 productName）一并置 null（人工录入名称不受影响）
 *  - 关联产品**可见** ⇒ `product` 仅保留 `fields` 白名单内的公开字段
 *    （`visibility` / `createdBy` / `visibleUsers` 等内部授权字段**必须**被剔除，不得进入响应）
 */
export const projectProductRow = <T>(
  req: AuthRequest,
  row: T,
  fields: readonly string[],
  options: { nameField?: string } = {},
): T => {
  const record = row as Record<string, unknown>;
  const raw = record.product as (ProductVisibilityShape & Record<string, unknown>) | null | undefined;
  if (!raw) return row;
  if (!canReadProduct(req, raw)) {
    const next: Record<string, unknown> = { ...record, product: null };
    if (options.nameField && record.productId != null) next[options.nameField] = null;
    return next as T;
  }
  const projected: Record<string, unknown> = {};
  for (const f of fields) if (f in raw) projected[f] = raw[f];
  return { ...record, product: projected } as T;
};

/** 读取侧投影（批量）：等价于对每行调用 projectProductRow */
export const projectProductRows = <T>(
  req: AuthRequest,
  rows: readonly T[],
  fields: readonly string[],
  options: { nameField?: string } = {},
): T[] => rows.map((row) => projectProductRow(req, row, fields, options));
