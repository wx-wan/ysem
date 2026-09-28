import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as dictionaryService from '../services/dictionary.service';
import { created, fail, success } from '../utils/response';

/**
 * CommunicationTool Controller —— Round R-5 · Phase 2 · Master Data Domain（字典域）
 * 职责与边界同 `currency.controller.ts`（Transport only）。API Contract 保持不变。
 */

const KIND = 'commTool' as const;
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

// 启用的沟通工具（用于下拉选择）
export const getActiveCommTools = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await dictionaryService.listActive(KIND));
  } catch (err) {
    respondError(res, err, false);
  }
};

// 全部沟通工具（用于设置页管理）
export const getAllCommTools = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const keyword = (req.query.keyword as string | undefined)?.trim();
    success(res, await dictionaryService.listAll(KIND, keyword));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const getCommTool = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await dictionaryService.getOne(KIND, req.params.id));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const createCommTool = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = schema.parse(req.body) as Record<string, unknown>;
    created(res, await dictionaryService.create(KIND, data));
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateCommTool = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = schema.partial().parse(req.body) as Record<string, unknown>;
    await dictionaryService.update(KIND, req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const deleteCommTool = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await dictionaryService.remove(KIND, req.params.id);
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};

// 批量更新排序
export const updateCommToolSort = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const items = dictionaryService.dictionarySortSchema.parse(req.body);
    await dictionaryService.updateSort(KIND, items);
    success(res, null, '排序更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};
