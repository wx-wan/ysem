import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as channelService from '../services/channel.service';
import { created, fail, success } from '../utils/response';

/**
 * Channel Controller —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、响应格式化。
 * **禁止** Prisma 访问 / 事务 / 业务规则 —— 已在 `services/channel.service.ts`（Business）
 * / `repositories/channel.repository.ts`（Data）。
 *
 * API Contract 保持不变（含 B4 删除保护的 409 语义）。
 */

function respondError(res: Response, err: unknown, zodAware: boolean): void {
  if (err instanceof DomainError) {
    fail(res, err.code, err.message);
    return;
  }
  if (zodAware && err instanceof z.ZodError) {
    fail(res, 400, err.errors.map((e) => e.message).join(', '));
    return;
  }
  fail(res, 500, '服务器错误');
}

// 全部渠道（用于下拉/级联选择）
export const getChannels = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await channelService.listAll());
  } catch (err) {
    respondError(res, err, false);
  }
};

// 树形结构：父节点(渠道) -> children(平台)
export const getChannelTree = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await channelService.tree());
  } catch (err) {
    respondError(res, err, false);
  }
};

export const getChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await channelService.getOne(req.params.id));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const createChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = channelService.channelSchema.parse(req.body);
    created(res, await channelService.create(data));
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = channelService.channelSchema.partial().parse(req.body);
    await channelService.update(req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const deleteChannel = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Round R-5 · Phase 1 冻结（B4）：已被销售记录引用的渠道/平台禁止删除，只允许停用。
    await channelService.remove(req.params.id);
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};
