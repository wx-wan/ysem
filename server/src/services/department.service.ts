import { z } from 'zod';
import {
  DomainConflictError,
  DomainNotFoundError,
  DomainValidationError,
} from '../lib/errors';
import { departmentRepository, userRepository } from '../repositories';

/**
 * Department Business Layer —— Round R-5 · Phase 4 · D4-a1 组织与权限主数据域
 *
 * 纯主数据：**零事务、零 Scope、零跨域**（Master Plan §13：不制造空壳 Operation）。
 *
 * 【T1-B 及配套（负责人）】
 *  - 原 `leader: z.string()` 为**死字段**（`Department` 无 `leader` 列，只有 `leaderId`），
 *    携带它会经 zod 后由 Prisma 拒绝（Unknown argument）→ 500。已依裁定删除。
 *  - 现补上 **`leaderId`**（负责人 userId）并配套：
 *      · 写入：校验该用户存在（`Department.leaderId` 为**无外键裸标量**，DB 不兜底）；
 *      · 读取：**手工联查**出 `leaderName`（无 relation，不能 `include`）；
 *      · 清空：前端传 `leaderId: null` 时置空（Prisma 对 `undefined` 视为「不更新」，
 *        故清空必须显式 `null`，否则无法解除负责人）。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例。
 */

export const departmentSchema = z.object({
  name: z.string().min(1).max(50),
  code: z.string().min(1).max(50),
  parentId: z.string().nullable().optional(),
  // T1-B：`leader` 死字段已删除（携带者现被 zod strip，不再 500）。
  // 负责人改以 `leaderId`（userId）承载；可空表示清空/未指定。
  leaderId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  sort: z.number().optional().default(0),
  status: z.number().optional().default(1),
});

export type DepartmentInput = z.infer<typeof departmentSchema>;

type DepartmentRow = Awaited<ReturnType<typeof departmentRepository.findManyWithUserCount>>[number];

/**
 * 负责人存在性校验。
 * `Department.leaderId` **无外键约束**，DB 不会拒绝不存在的 userId，故必须由业务层兜底。
 * `null` / `''` / `undefined` 一律视为「未指定 / 清空」，直接放行。
 */
async function assertLeaderExists(leaderId: string | null | undefined): Promise<void> {
  if (!leaderId) return;
  const found = await userRepository.findIdNamePairsByIds([leaderId]);
  if (found.length === 0) throw new DomainValidationError('负责人不存在');
}

/**
 * 附加派生字段 `leaderName`（负责人显示名）。
 *
 * 实现说明：`Department` 与 `User` 之间**没有 Prisma relation**（`leaderId` 是裸标量），
 * 因此不能 `include`，只能按去重后的 id 集合**一次批量联查**（无 N+1）。
 * 用户不存在 / 已删除 → `leaderName` 为 `null`（不伪造、不置占位符）。
 */
async function attachLeaderNames<T extends { leaderId: string | null }>(
  rows: T[],
): Promise<Array<T & { leaderName: string | null }>> {
  const ids = Array.from(
    new Set(rows.map((r) => r.leaderId).filter((v): v is string => Boolean(v))),
  );
  const pairs = await userRepository.findIdNamePairsByIds(ids);
  const nameById = new Map(pairs.map((u) => [u.id, u.realName ?? u.username]));
  return rows.map((r) => ({
    ...r,
    leaderName: r.leaderId ? nameById.get(r.leaderId) ?? null : null,
  }));
}

/** 部门列表（含用户计数 + 负责人显示名） */
export async function list(): Promise<Array<DepartmentRow & { leaderName: string | null }>> {
  return attachLeaderNames(await departmentRepository.findManyWithUserCount());
}

/**
 * 部门树。
 *
 * 【既有契约，逐字保留】本端点当前返回的是与「部门列表」**完全相同**的**扁平列表**
 * （含 `_count.users`），层级由前端组装（`scope/deptTree.ts` 的组织树推导属 Scope 能力，
 * 不用于本端点）。本轮**不改变该行为** —— 若需改为服务端建树，属独立 API 变更轮次。
 */
export async function tree() {
  return attachLeaderNames(await departmentRepository.findManyWithUserCount());
}

/** 单个部门（含用户计数 + 负责人显示名） */
export async function getOne(id: string) {
  const department = await departmentRepository.findByIdWithUserCount(id);
  if (!department) throw new DomainNotFoundError('部门不存在');
  return (await attachLeaderNames([department]))[0];
}

/** 创建部门（编码唯一；负责人必须存在） */
export async function create(data: DepartmentInput) {
  const existing = await departmentRepository.findByCode(data.code);
  if (existing) throw new DomainConflictError('部门编码已存在');
  await assertLeaderExists(data.leaderId);
  const created = await departmentRepository.create(data);
  return (await attachLeaderNames([created]))[0];
}

/** 更新部门（部分更新；沿用既有行为 —— 仅按 id 定位，不额外查重） */
export async function update(id: string, data: Partial<DepartmentInput>) {
  await assertLeaderExists(data.leaderId);
  const updated = await departmentRepository.update(id, data);
  return (await attachLeaderNames([updated]))[0];
}

/** 删除部门 */
export function remove(id: string) {
  return departmentRepository.delete(id);
}
