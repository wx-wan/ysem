import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import type { SalesActorContext } from '../services/salesProcess.shared';
import * as shipmentService from '../services/shipment.service';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, roleScope } from '../utils/scope';

/**
 * Shipment Controller —— Round R-5 · Phase 4 · D1-c 出运域
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、上下文注入、错误映射。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在
 *   `services/shipment.service.ts`（Business：出货上限 / C-3 数量门禁 / C-2 出运前质检门禁
 *    / 快照解析 / SHIPPABLE 白名单）
 *   `state/shipmentState.state.ts`（State：ShipmentStatus 状态机，**纯规则**）
 *   `operations/shipment.operations.ts`（Operation：SalesOrderItem 行锁 + shippedQty 派生汇总重算）
 *   `repositories/*`（Data）。API Contract 保持不变。
 *
 * 【归位说明】原控制器内联的 `ALLOWED_SHIPMENT_TRANSITIONS` / `checkShipmentStatusTransition`
 * 已移至 State 能力（行为逐字不变）。
 */

function buildActorContext(req: AuthRequest): SalesActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    roleCode: req.roleCode,
    ip: req.ip,
    scope: {
      owner: () => roleScope(req, { field: 'ownerId' }),
      assignee: () => roleScope(req, { field: 'id' }),
      productVisibility: () => productVisibilityWhere(req),
    },
  };
}

function respondError(res: Response, err: unknown): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// ============ 列表 ============
export const listShipments = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = shipmentService.shipmentListQuerySchema.parse(req.query);
    success(res, await shipmentService.list(query, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============
export const getShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await shipmentService.getOne(req.params.id, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 新建（事务：上限校验 → 建单 → 重算 shippedQty） ============
export const createShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = shipmentService.shipmentCreateSchema.parse(req.body);
    created(res, await shipmentService.create(body, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 更新（事务：先删旧明细 → 上限校验 → Eligibility Gate → 重建 → 重算） ============
export const updateShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id, ...rest } = shipmentService.shipmentUpdateSchema.parse({
      id: req.params.id,
      ...req.body,
    });
    success(res, await shipmentService.update(id, rest, buildActorContext(req)), '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 删除（V1.0：禁止物理删除，统一 409；废弃请改用 DRAFT → CANCELLED） ============
export const removeShipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await shipmentService.remove(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};
