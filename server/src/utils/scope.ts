import type { AuthRequest } from '../middleware/auth';

/**
 * 数据范围（Data Scope）通用工具
 *
 * 系统按当前登录用户角色控制可见数据范围：
 *  - 管理员（roleCode === 'admin'）：可查看全部数据，返回 {} 表示不附加范围过滤
 *  - 普通用户：仅可查看 自己负责的数据 与 公海数据（无负责人）
 *
 * 各业务列表（客户、订单、线索、销售机会等）统一复用本工具，
 * 避免在每个控制器中重复编写 ownerId / roleCode 判断逻辑。
 * 支持嵌套关联字段（如订单的负责人在 customer.ownerId，传 relation: 'customer'）。
 */

export const isAdmin = (req: AuthRequest): boolean =>
  req.roleCode === 'admin' || req.roleCode === 'ADMIN';

/**
 * 生成「负责人」范围条件。
 * @param field  负责人字段名，默认 'ownerId'
 * @param includePublicSea 是否包含公海（field 为 null 的数据），默认 true
 *
 * - 管理员：返回 {}（不限制）
 * - 普通用户：返回 { field: uid } 或 { OR: [{ field: uid }, { field: null }] }
 */
export const ownerScope = (
  req: AuthRequest,
  options: { field?: string; includePublicSea?: boolean; relation?: string } = {},
): Record<string, unknown> => {
  const field = options.field ?? 'ownerId';
  const includePublicSea = options.includePublicSea ?? true;
  const relation = options.relation;
  if (isAdmin(req)) return {};
  const uid = req.userId;
  if (!uid) return {};
  // 负责人条件：自己负责的 + （可选）公海（无负责人）
  const inner = includePublicSea
    ? { OR: [{ [field]: uid }, { [field]: null }] }
    : { [field]: uid };
  // 支持嵌套关联字段，如订单的负责人在 customer.ownerId
  return relation ? { [relation]: inner } : inner;
};

/**
 * 公海范围条件：仅返回 field 为 null 的数据（无负责人）。
 */
export const publicSeaScope = (
  req: AuthRequest,
  field = 'ownerId',
): Record<string, unknown> => ({ [field]: null });

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
