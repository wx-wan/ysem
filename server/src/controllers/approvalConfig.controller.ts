import { Response } from 'express';
import { z } from 'zod';
import { ApprovalBizType, Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

// ============================================================
// 审批配置（V1.0 · ApprovalConfig）
//
//  - 业务类型字段为 `bizType`（ApprovalBizType enum，**@unique**），**不得**使用 legacy `type`；
//  - 只覆盖冻结的 8 个值：QUOTATION / SAMPLE_ORDER / SALES_ORDER / PRODUCTION_ORDER /
//    SHIPMENT / PURCHASE_ORDER / PAYMENT / PROFIT（enum 中不存在 QUALITY_INSPECTION → 自动 400）；
//  - 每个 bizType 最多一条配置（schema @unique）；
//  - `flow` 仅作合法 JSON 保存，**不参与 runtime**（多级审批 Deferred）；
//  - 本文件的配置 CRUD 与 legacy `approval.controller.ts`（/api/approvals）并存，legacy 保持原状。
//
// 已 Deferred：
//  - 多级审批 runtime（flow / level）
//  - 按金额 / 条件匹配审批
//  - ApprovalConfig 的 OperationLog（businessType 无 APPROVAL 语义值，且伪造 businessNo 会污染业务日志）
//  - seed 初始化默认配置（本轮不初始化）
// ============================================================

const bizTypeSchema = z.nativeEnum(ApprovalBizType);

const configSchema = z.object({
  bizType: bizTypeSchema,
  approverIds: z.array(z.string().min(1)).min(1, '审批人不能为空'),
  approverNames: z.array(z.string()).optional().nullable(),
  flow: z.unknown().optional().nullable(),
  enabled: z.boolean().optional(),
});

const updateSchema = z.object({
  approverIds: z.array(z.string().min(1)).min(1, '审批人不能为空').optional(),
  approverNames: z.array(z.string()).optional().nullable(),
  flow: z.unknown().optional().nullable(),
  enabled: z.boolean().optional(),
});

/** 审批人 id 规范化：全部为非空字符串且**不允许重复**（重复 → 400） */
function normalizeApproverIds(ids: string[]): { ok: true; ids: string[] } | { ok: false; message: string } {
  const trimmed = ids.map((id) => id.trim());
  if (trimmed.some((id) => id.length === 0)) {
    return { ok: false, message: '审批人不能包含空值' };
  }
  if (new Set(trimmed).size !== trimmed.length) {
    return { ok: false, message: '审批人不能重复' };
  }
  if (trimmed.length === 0) {
    return { ok: false, message: '审批人不能为空' };
  }
  return { ok: true, ids: trimmed };
}

/** flow 入参 → Prisma Json 写入值（undefined 不写；null → DB NULL；其余按 JSON 原样保存） */
function toJsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value as Prisma.InputJsonValue;
}

function isUniqueError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

// ============ 列表 ============
export const listApprovalConfigs = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.approvalConfig.findMany({ orderBy: { bizType: 'asc' } });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

// ============ 详情（按 bizType） ============
export const getApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = bizTypeSchema.parse(req.params.bizType);
    const cfg = await prisma.approvalConfig.findUnique({ where: { bizType } });
    if (!cfg) {
      fail(res, 404, '审批配置不存在');
      return;
    }
    success(res, cfg);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, '不支持的审批业务类型');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 新建（每个 bizType 仅一条，已存在 → 409） ============
export const createApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = configSchema.parse(req.body);

    const approvers = normalizeApproverIds(body.approverIds);
    if (!approvers.ok) {
      fail(res, 400, approvers.message);
      return;
    }

    const existing = await prisma.approvalConfig.findUnique({ where: { bizType: body.bizType } });
    if (existing) {
      fail(res, 409, '该业务类型的审批配置已存在');
      return;
    }

    const cfg = await prisma.approvalConfig.create({
      data: {
        bizType: body.bizType,
        approverIds: JSON.stringify(approvers.ids),
        approverNames: body.approverNames ? JSON.stringify(body.approverNames) : null,
        flow: toJsonInput(body.flow),
        enabled: body.enabled ?? true,
      },
    });
    created(res, cfg);
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    if (isUniqueError(e)) {
      fail(res, 409, '该业务类型的审批配置已存在');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 更新（不存在 → 404） ============
export const updateApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = bizTypeSchema.parse(req.params.bizType);
    const body = updateSchema.parse(req.body);

    const existing = await prisma.approvalConfig.findUnique({ where: { bizType } });
    if (!existing) {
      fail(res, 404, '审批配置不存在');
      return;
    }

    const data: Prisma.ApprovalConfigUpdateInput = {};
    if (body.approverIds !== undefined) {
      const approvers = normalizeApproverIds(body.approverIds);
      if (!approvers.ok) {
        fail(res, 400, approvers.message);
        return;
      }
      data.approverIds = JSON.stringify(approvers.ids);
    }
    if (body.approverNames !== undefined) {
      data.approverNames = body.approverNames ? JSON.stringify(body.approverNames) : null;
    }
    if (body.flow !== undefined) data.flow = toJsonInput(body.flow);
    if (body.enabled !== undefined) data.enabled = body.enabled;

    const cfg = await prisma.approvalConfig.update({ where: { bizType }, data });
    success(res, cfg, '更新成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, e.errors.map((err) => err.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

// ============ 删除（不存在 → 404） ============
export const removeApprovalConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const bizType = bizTypeSchema.parse(req.params.bizType);

    const existing = await prisma.approvalConfig.findUnique({ where: { bizType } });
    if (!existing) {
      fail(res, 404, '审批配置不存在');
      return;
    }

    await prisma.approvalConfig.delete({ where: { bizType } });
    success(res, null, '删除成功');
  } catch (e) {
    if (e instanceof z.ZodError) {
      fail(res, 400, '不支持的审批业务类型');
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
