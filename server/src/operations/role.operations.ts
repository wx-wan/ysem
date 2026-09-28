import { roleRepository, runInTransaction } from '../repositories';

/**
 * Role Operation Layer —— Round R-5 · Phase 4 · D4-a2 账号与角色域
 *
 * 职责：**事务编排**。本域唯一的写事务是「重建角色权限关联」——
 * 「先清空旧关联 → 再批量写入新关联」必须整体原子，否则中途失败会留下**空权限角色**。
 *
 * 迁移前写法为 `prisma.$transaction([deleteMany, createMany])`（数组形式，语义等价原子）；
 * 本轮改为函数形式，以便将来在同一事务内追加编排（当前无追加项，行为不变）。
 *
 * 不负责业务口径：「角色是否存在」「permissionIds 是否为数组」等判定在
 * `services/role.service.ts`（Business）与 Controller（DTO 校验）。
 *
 * 【事务归属（Master Plan §12）】本文件是账号与角色域 `$transaction` 的唯一归属地。
 */
export function assignPermissionsAggregate(
  roleId: string,
  permissionIds: string[],
): Promise<[unknown, { count: number }]> {
  return runInTransaction(async (tx) => {
    const deleted = await roleRepository.deletePermissionsByRoleId(roleId, tx);
    const created = await roleRepository.createPermissions(
      permissionIds.map((permissionId) => ({ roleId, permissionId })),
      tx,
    );
    return [deleted, created];
  });
}
