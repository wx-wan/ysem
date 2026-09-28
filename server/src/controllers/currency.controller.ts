import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as dictionaryService from '../services/dictionary.service';
import { created, fail, success } from '../utils/response';

/**
 * Currency Controller —— Round R-5 · Phase 2 · Master Data Domain（字典域）
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、响应格式化。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/dictionary.service.ts`（Business）
 * / `operations/dictionary.operations.ts`（Operation）/ `repositories/dictionary.repository.ts`（Data）。
 *
 * API Contract 保持不变。
 */

const KIND = 'currency' as const;
const schema = dictionaryService.schemaOf(KIND);

function respondError(res: Response, err: unknown, zodAware: boolean): void {
  if (zodAware && err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  fail(res, 500, '服务器错误');
}

// 启用的币种（用于下拉选择 + 顶部币种切换）
export const getActiveCurrencies = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await dictionaryService.listActive(KIND));
  } catch (err) {
    respondError(res, err, false);
  }
};

// 全部币种（用于设置页管理）
export const getAllCurrencies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = (req.query.keyword as string | undefined)?.trim();
    success(res, await dictionaryService.listAll(KIND, keyword));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const getCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await dictionaryService.getOne(KIND, req.params.id));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const createCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = schema.parse(req.body) as Record<string, unknown>;
    created(res, await dictionaryService.create(KIND, data));
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = schema.partial().parse(req.body) as Record<string, unknown>;
    await dictionaryService.update(KIND, req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const deleteCurrency = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await dictionaryService.remove(KIND, req.params.id);
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// 批量更新排序
export const updateCurrencySort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = dictionaryService.dictionarySortSchema.parse(req.body);
    await dictionaryService.updateSort(KIND, items);
    success(res, null, '排序更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};
