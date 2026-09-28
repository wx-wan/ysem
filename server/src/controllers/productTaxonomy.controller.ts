import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import * as taxonomyService from '../services/productTaxonomy.service';
import { success, created, fail } from '../utils/response';

/**
 * Product 分类主数据 Controller（Round R-4 · Product Layering）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO/schema 校验、HTTP 状态码、response formatting。
 * **禁止**：Prisma 访问、数据库查询、复杂业务判断 —— 已迁往 services / repositories。
 *
 * API Contract 保持不变：请求字段、响应结构、错误码与文案逐项未改。
 * 导出名与既有路由引用一致（`routes/productTaxonomy.routes.ts` 无需改动）。
 */

function respondError(res: Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// ============ 工艺 ProductCraft ============

export const getCrafts = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await taxonomyService.listCrafts());
  } catch { fail(res, 500, '服务器错误'); }
};

export const createCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.craftSchema.parse(req.body);
    created(res, await taxonomyService.createCraft(data));
  } catch (err) {
    respondError(res, err);
  }
};

export const updateCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.craftSchema.partial().parse(req.body);
    await taxonomyService.updateCraft(req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

export const deleteCraft = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await taxonomyService.deleteCraft(req.params.id);
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};

// ============ 受众 ProductAudience ============

export const getAudiences = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await taxonomyService.listAudiences());
  } catch { fail(res, 500, '服务器错误'); }
};

export const createAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.audienceSchema.parse(req.body);
    created(res, await taxonomyService.createAudience(data));
  } catch (err) {
    respondError(res, err);
  }
};

export const updateAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.audienceSchema.partial().parse(req.body);
    await taxonomyService.updateAudience(req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

export const deleteAudience = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await taxonomyService.deleteAudience(req.params.id);
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};

// ============ 品类 ProductCategory ============

export const getCategories = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await taxonomyService.listCategories());
  } catch { fail(res, 500, '服务器错误'); }
};

export const createCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.categorySchema.parse(req.body);
    created(res, await taxonomyService.createCategory(data));
  } catch (err) {
    respondError(res, err);
  }
};

export const updateCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = taxonomyService.categorySchema.partial().parse(req.body);
    await taxonomyService.updateCategory(req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err);
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await taxonomyService.deleteCategory(req.params.id);
    success(res, null, '删除成功');
  } catch { fail(res, 500, '服务器错误'); }
};
