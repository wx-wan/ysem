import { Response } from 'express';
import { z } from 'zod';
import { DomainError } from '../lib/errors';
import { AuthRequest } from '../middleware/auth';
import * as certificateService from '../services/certificate.service';
import { created, fail, success } from '../utils/response';

/**
 * Certificate Controller —— Round R-5 · Phase 2 · Master Data Domain
 *
 * 职责（仅此）：HTTP request/response、参数解析、DTO 校验、响应格式化。
 * **禁止** Prisma 访问 / 业务规则 —— 已在 `services/certificate.service.ts`
 * / `repositories/certificate.repository.ts`。API Contract 保持不变。
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

// 列表（不分页，证书数量有限）
export const getCertificates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await certificateService.list());
  } catch (err) {
    respondError(res, err, false);
  }
};

export const getCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    success(res, await certificateService.getOne(req.params.id));
  } catch (err) {
    respondError(res, err, false);
  }
};

export const createCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = certificateService.certificateSchema.parse(req.body);
    created(res, await certificateService.create(data));
  } catch (err) {
    respondError(res, err, true);
  }
};

export const updateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = certificateService.certificateSchema.partial().parse(req.body);
    await certificateService.update(req.params.id, data);
    success(res, null, '更新成功');
  } catch (err) {
    respondError(res, err, true);
  }
};

export const deleteCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await certificateService.remove(req.params.id);
    success(res, null, '删除成功');
  } catch (err) {
    respondError(res, err, false);
  }
};
