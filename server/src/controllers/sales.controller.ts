import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as opportunityService from '../services/opportunity.service';
import type { SalesActorContext } from '../services/salesProcess.shared';
import { created, fail, success } from '../utils/response';
import { productVisibilityWhere, projectProductRows, roleScope } from '../scope';

/**
 * Sales（Opportunity）Controller —— Round R-5 · Phase 1 · Sales Process Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、HTTP 上下文注入、
 *              状态码与响应格式化。
 *
 * **禁止**：Prisma 访问、事务编排、业务规则、状态机、跨实体流程
 * —— 均已迁往 `services/opportunity.service.ts`（Business）
 *    / `operations/sales.operations.ts`（Operation，唯一事务归属）
 *    / `repositories/*`（Data）。
 *
 * API Contract 保持稳定；本轮**刻意收紧**的两处业务行为已在 Phase 1 报告中记录：
 *   ① `leadId` 成为创建必填（B2）；
 *   ② `channelId / shopId / leadId` 更新不可变（D7）。
 */

/** 明细关联产品的公开字段（DQ-3=C 投影白名单；内部授权字段不得进入响应） */
const OPPORTUNITY_ITEM_PRODUCT_FIELDS = ['id', 'name', 'sku'] as const;

/** 读取侧（DQ-3=C）：明细关联产品按可见性投影（不可见 ⇒ product=null；历史快照保持） */
const withProductVisibility = <T>(req: AuthRequest, record: T): T => {
  const rec = record as Record<string, unknown>;
  return {
    ...rec,
    items: projectProductRows(
      req,
      (rec.items ?? []) as Record<string, unknown>[],
      OPPORTUNITY_ITEM_PRODUCT_FIELDS,
      { nameField: 'productName' },
    ),
  } as T;
};

/** HTTP 边界上下文组装：req 只在本函数内被读取 */
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

/** 错误映射（HTTP 边界职责）：DomainError → 既有 {code,message}；ZodError → 400；其它 → 500 */
function respondError(res: Response, err: unknown, zodMessage?: string): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (err instanceof z.ZodError) {
    const detail = err.errors.map((e) => e.message).join(', ');
    fail(res, 400, zodMessage ? `${zodMessage}${detail}` : detail);
    return;
  }
  console.error(err);
  fail(res, 500, '服务器错误');
}

// ============ 列表 ============

export const getOpportunities = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const q = req.query as Record<string, string>;
    const result = await opportunityService.listOpportunities(
      {
        page: q.page,
        pageSize: q.pageSize,
        keyword: q.keyword,
        stage: q.stage,
        ownerId: q.ownerId,
        channel: q.channel,
        platform: q.platform,
        startDate: q.startDate,
        endDate: q.endDate,
      },
      buildActorContext(req),
    );
    success(res, {
      list: result.list.map((o) => withProductVisibility(req, o)),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 看板统计 ============

export const getKanban = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await opportunityService.getKanban(buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 详情 ============

export const getOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await opportunityService.getOpportunity(req.params.id, buildActorContext(req));
    success(res, withProductVisibility(req, item));
  } catch (err) {
    respondError(res, err);
  }
};

/** GET /api/sales/:id/logs —— 商机操作记录（详情「活动记录」Tab 数据源） */
export const getSalesLogs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await opportunityService.getSalesLogs(req.params.id, buildActorContext(req));
    success(res, { list });
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 按产品 / 按客户查询 ============

export const getByProduct = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await opportunityService.getByProduct(req.params.productId, buildActorContext(req)));
  } catch (err) {
    respondError(res, err);
  }
};

export const getByCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const opportunities = await opportunityService.getByCustomer(
      req.params.customerId,
      buildActorContext(req),
    );
    success(res, opportunities);
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 创建 ============

export const createOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = opportunityService.opportunityCreateSchema.parse(req.body);
    const opportunity = await opportunityService.createOpportunity(data, buildActorContext(req));
    created(res, withProductVisibility(req, opportunity), '创建成功');
  } catch (err) {
    respondError(res, err, '参数校验失败：');
  }
};

// ============ 更新 ============

export const updateOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // 既有契约：id 来自路径参数，请求体不携带 id（schema 与既有 `createOpportunitySchema.partial()` 一致）
    const rest = opportunityService.opportunityUpdateSchema.parse(req.body);
    const opportunity = await opportunityService.updateOpportunity(
      req.params.id,
      rest,
      buildActorContext(req),
    );
    success(res, withProductVisibility(req, opportunity), '更新成功');
  } catch (err) {
    respondError(res, err, '参数校验失败：');
  }
};

// ============ 删除 ============

export const deleteOpportunity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await opportunityService.deleteOpportunity(req.params.id, buildActorContext(req));
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err);
  }
};

// ============ 批量删除 ============

export const batchDelete = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()) }).parse(req.body);
    const count = await opportunityService.batchDeleteOpportunities(ids, buildActorContext(req));
    success(res, null, `已删除 ${count} 条记录`);
  } catch (err) {
    respondError(res, err, '参数校验失败');
  }
};

// ============ Excel 导入 ============

export const importExcel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      fail(res, 400, '请上传文件');
      return;
    }
    const result = await opportunityService.importOpportunitiesFromBuffer(
      req.file.buffer,
      buildActorContext(req),
    );
    success(res, result);
  } catch (err) {
    if (err instanceof DomainError) {
      fail(res, err.code, err.message);
      return;
    }
    fail(res, 500, '文件解析失败');
  }
};

// ============ 获取用户列表（用于分配） ============

export const getAssignUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await opportunityService.getAssignUsers());
  } catch (err) {
    respondError(res, err);
  }
};
