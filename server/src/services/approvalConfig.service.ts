import { ApprovalBizType, Prisma } from '@prisma/client';
import { z } from 'zod';
import { DomainConflictError, DomainNotFoundError, DomainValidationError } from '../lib/errors';
import { approvalConfigRepository } from '../repositories';

/**
 * ApprovalConfig Business Layer —— Round R-5 · Phase 4 · D3 审批域
 *
 * 审批配置（V1.0 · ApprovalConfig）：
 *   · `bizType` 为 **@unique**（每个业务类型最多一条配置）；
 *   · 只覆盖冻结的 8 个值（enum 中不存在 QUALITY_INSPECTION → 自动 400）；
 *   · `flow` 仅作合法 JSON 保存，**不参与 runtime**（多级审批 Deferred）；
 *   · 审批人 id 必须非空且**不允许重复**；
 *   · 本域 Deferred：多级审批 runtime、按金额/条件匹配、ApprovalConfig 的 OperationLog、seed 初始化。
 *
 * 约束：不读 req / res、不返回 HTTP、不出现 `$transaction`、不直接 import Prisma 单例
 *（`Prisma.*` 仅作类型与 `DbNull` 值使用）。
 */

export const approvalBizTypeSchema = z.nativeEnum(ApprovalBizType);

export const approvalConfigCreateSchema = z.object({
  bizType: approvalBizTypeSchema,
  approverIds: z.array(z.string().min(1)).min(1, '审批人不能为空'),
  approverNames: z.array(z.string()).optional().nullable(),
  flow: z.unknown().optional().nullable(),
  enabled: z.boolean().optional(),
});

export const approvalConfigUpdateSchema = z.object({
  approverIds: z.array(z.string().min(1)).min(1, '审批人不能为空').optional(),
  approverNames: z.array(z.string()).optional().nullable(),
  flow: z.unknown().optional().nullable(),
  enabled: z.boolean().optional(),
});

export type ApprovalConfigCreateInput = z.infer<typeof approvalConfigCreateSchema>;
export type ApprovalConfigUpdateInput = z.infer<typeof approvalConfigUpdateSchema>;

/** 审批人 id 规范化：全部为非空字符串且**不允许重复**（重复 → 400） */
export function normalizeApproverIds(ids: string[]): string[] {
  const trimmed = ids.map((id) => id.trim());
  if (trimmed.some((id) => id.length === 0)) throw new DomainValidationError('审批人不能包含空值');
  if (new Set(trimmed).size !== trimmed.length) throw new DomainValidationError('审批人不能重复');
  if (trimmed.length === 0) throw new DomainValidationError('审批人不能为空');
  return trimmed;
}

/** flow 入参 → Prisma Json 写入值（undefined 不写；null → DB NULL；其余按 JSON 原样保存） */
function toJsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/** 列表 */
export function list() {
  return approvalConfigRepository.findAll();
}

/** 详情（不存在 → 404「审批配置不存在」） */
export async function getByBizType(bizType: ApprovalBizType) {
  const cfg = await approvalConfigRepository.findByBizType(bizType);
  if (!cfg) throw new DomainNotFoundError('审批配置不存在');
  return cfg;
}

/** 新建（每个 bizType 仅一条；已存在 → 409） */
export async function create(body: ApprovalConfigCreateInput) {
  const ids = normalizeApproverIds(body.approverIds);

  const existing = await approvalConfigRepository.findByBizType(body.bizType);
  if (existing) throw new DomainConflictError('该业务类型的审批配置已存在');

  try {
    return await approvalConfigRepository.create({
      bizType: body.bizType,
      approverIds: JSON.stringify(ids),
      approverNames: body.approverNames ? JSON.stringify(body.approverNames) : null,
      flow: toJsonInput(body.flow),
      enabled: body.enabled ?? true,
    });
  } catch (e) {
    // 并发创建：由 schema @unique 承担最终断言，与顺序路径同 409 语义与文案
    if (isUniqueError(e)) throw new DomainConflictError('该业务类型的审批配置已存在');
    throw e;
  }
}

/** 更新（不存在 → 404） */
export async function update(bizType: ApprovalBizType, body: ApprovalConfigUpdateInput) {
  const existing = await approvalConfigRepository.findByBizType(bizType);
  if (!existing) throw new DomainNotFoundError('审批配置不存在');

  const data: Prisma.ApprovalConfigUncheckedUpdateInput = {};
  if (body.approverIds !== undefined) {
    data.approverIds = JSON.stringify(normalizeApproverIds(body.approverIds));
  }
  if (body.approverNames !== undefined) {
    data.approverNames = body.approverNames ? JSON.stringify(body.approverNames) : null;
  }
  if (body.flow !== undefined) data.flow = toJsonInput(body.flow);
  if (body.enabled !== undefined) data.enabled = body.enabled;

  return approvalConfigRepository.updateByBizType(bizType, data);
}

/** 删除（不存在 → 404） */
export async function remove(bizType: ApprovalBizType) {
  const existing = await approvalConfigRepository.findByBizType(bizType);
  if (!existing) throw new DomainNotFoundError('审批配置不存在');
  await approvalConfigRepository.deleteByBizType(bizType);
}
