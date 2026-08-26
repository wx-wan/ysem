import type { AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

/**
 * 数据范围（Data Scope）通用工具
 *
 * 系统按当前登录用户【角色】的数据范围（Role.dataScope）控制可见数据，共三档：
 *  - ALL   全部数据：可查询企业全部数据（管理员恒为全部，由 requirePerm / isAdmin 放行）
 *  - DEPT  本部门数据：本部门所有成员负责的数据（用户无部门时退化为仅本人）
 *  - SELF  仅本人数据：仅本人负责的数据
 *
 * 【公海 / 公开数据规则】
 * 公海数据（负责人字段为 null，如未认领客户、未指派线索）对集团内所有登录用户开放，
 * 属于内置规则，由 roleScope 统一并入范围条件，调用方无需单独控制（不再提供 includePublicSea 参数）。
 *
 * 各业务列表（客户、订单、线索、销售机会、采购等）统一复用 roleScope，
 * 避免在每个控制器中重复编写 ownerId / roleCode 判断逻辑。
 * 支持嵌套关联字段（如订单的负责人在 customer.ownerId，传 relation: 'customer'）。
 */

export type DataScope = 'ALL' | 'DEPT' | 'SELF';

export const DATA_SCOPES: DataScope[] = ['ALL', 'DEPT', 'SELF'];

export const DATA_SCOPE_LABELS: Record<DataScope, string> = {
  ALL: '全部数据',
  DEPT: '本部门数据',
  SELF: '仅本人数据',
};

export const DEFAULT_DATA_SCOPE: DataScope = 'SELF';

export const isAdmin = (req: AuthRequest): boolean =>
  req.roleCode === 'admin' || req.roleCode === 'ADMIN';

/**
 * 获取当前用户所在部门（仅本部门，不含下级）的所有用户 id。
 * 用户无部门时返回空数组（由调用方退化为本人范围）。
 */
const getDeptUserIds = async (userId: string): Promise<string[]> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { departmentId: true },
  });
  if (!user?.departmentId) return [];
  const users = await prisma.user.findMany({
    where: { departmentId: user.departmentId },
    select: { id: true },
  });
  return users.map((u) => u.id);
};

/**
 * 生成「角色可见范围」条件（异步：DEPT 范围需查询部门成员）。
 * @param field  负责人字段名，默认 'ownerId'
 * @param relation 嵌套关联字段（如订单负责人挂在 customer.ownerId，传 'customer'）
 *
 * 规则：
 * - 管理员 / dataScope=ALL：返回 {}（不限制）
 * - DEPT：本部门所有成员负责的数据 + 公海（无部门退化为本人 + 公海）
 * - SELF：本人负责的数据 + 公海
 *
 * 公海（负责人为 null）数据对集团所有登录用户开放，统一内置在条件中。
 */
export const roleScope = async (
  req: AuthRequest,
  options: { field?: string; relation?: string } = {},
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
      const deptUserIds = await getDeptUserIds(uid);
      if (deptUserIds.length > 0) {
        // 本部门所有成员负责的数据 + 公海（公开数据集团开放）
        inner = { OR: [{ [field]: { in: deptUserIds } }, { [field]: null }] };
      } else {
        // 用户未配置部门：退化为本人 + 公海，保证至少能看到自己数据
        inner = { OR: [{ [field]: uid }, { [field]: null }] };
      }
      break;
    }
    case 'SELF':
    default:
      // 仅本人负责的数据 + 公海（公开数据集团开放）
      inner = { OR: [{ [field]: uid }, { [field]: null }] };
  }

  // 支持嵌套关联字段，如订单的负责人在 customer.ownerId
  return relation ? { [relation]: inner } : inner;
};

/**
 * 生成「负责人」范围条件（同步兼容版，等价于 dataScope=SELF：仅本人负责的数据 + 公海）。
 * 新代码请使用 roleScope 以支持角色配置的数据范围。
 */
export const ownerScope = (
  req: AuthRequest,
  options: { field?: string; relation?: string } = {},
): Record<string, unknown> => {
  const field = options.field ?? 'ownerId';
  const relation = options.relation;
  if (isAdmin(req)) return {};
  const uid = req.userId;
  if (!uid) return {};
  // 本人负责的数据 + 公海（无负责人，对集团开放）
  const inner = { OR: [{ [field]: uid }, { [field]: null }] };
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
