import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { SkuConcurrencyError } from '../lib/skuCode';
import { AuthRequest } from '../middleware/auth';
import * as productGroupService from '../services/productGroup.service';
import { success, created, fail } from '../utils/response';
import { projectProductRows } from '../utils/scope';

/**
 * ComboProduct（产品组合）Controller（Round R-4 · Product Layering）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO/schema 校验、HTTP 状态码、response formatting。
 * **禁止**：Prisma 访问、数据库查询、事务编排、复杂业务判断 —— 已迁往 services / operations / repositories。
 *
 * API Contract 保持不变：请求字段、响应结构、错误码与文案逐项未改。
 * 导出名与既有路由引用一致（`routes/productGroup.routes.ts` 无需改动）。
 */

function buildActorContext(req: AuthRequest): productGroupService.ProductGroupActorContext {
  return {
    userId: req.userId,
    username: req.username,
    realName: req.realName,
    projectRows: (rows, fields, options) => projectProductRows(req, rows, fields, options),
  };
}

// 列表（含成员产品简要信息）
export const getProductGroups = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await productGroupService.listProductGroups(
      {
        page: req.query.page as string,
        pageSize: req.query.pageSize as string,
        keyword: req.query.keyword as string,
      },
      buildActorContext(req),
    );
    success(res, result);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getProductGroupById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const detail = await productGroupService.getProductGroupDetail(req.params.id, buildActorContext(req));
    success(res, detail);
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    fail(res, 500, '服务器错误');
  }
};

export const createProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productGroupService.groupSchema.parse(req.body);
    const group = await productGroupService.createProductGroup(parsed, buildActorContext(req));
    created(res, group);
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    if (err instanceof SkuConcurrencyError) {
      console.error('[createProductGroup] sku conflict', err.cause);
      fail(res, 409, err.message);
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = productGroupService.groupSchema.partial().parse(req.body);
    const group = await productGroupService.updateProductGroup(req.params.id, parsed, buildActorContext(req));
    success(res, group);
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteProductGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await productGroupService.deleteProductGroup(req.params.id, buildActorContext(req));
    success(res, result);
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    fail(res, 500, '服务器错误');
  }
};

// 向组合添加 / 移除单品（通过 items 关联维护，组合无 productIds 冗余字段）
export const updateGroupProducts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const body = productGroupService.groupItemsSchema.parse(req.body);
    const group = await productGroupService.updateGroupProducts(req.params.id, body, buildActorContext(req));
    success(res, group);
  } catch (err) {
    if (err instanceof DomainError) { fail(res, err.code, err.message); return; }
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};
