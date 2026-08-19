import { Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { AuthRequest } from '../middleware/auth';
import { success, created, fail } from '../utils/response';

const certificateSchema = z.object({
  name: z.string().min(1, '证书名称不能为空'),
  code: z.string().trim().max(50).optional(),
  issuer: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  validUntil: z.string().optional(), // ISO 字符串，可选
  status: z.number().int().optional(),
  remark: z.string().trim().max(500).optional(),
});

// 列表（不分页，证书数量有限）
export const getCertificates = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const list = await prisma.certificate.findMany({ orderBy: [{ createdAt: 'asc' }] });
    success(res, list);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const getCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const item = await prisma.certificate.findUnique({ where: { id: req.params.id } });
    if (!item) {
      fail(res, 404, '证书不存在');
      return;
    }
    success(res, item);
  } catch {
    fail(res, 500, '服务器错误');
  }
};

export const createCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = certificateSchema.parse(req.body);
    const item = await prisma.certificate.create({
      data: {
        name: data.name,
        code: data.code ?? null,
        issuer: data.issuer ?? null,
        category: data.category ?? null,
        validUntil: data.validUntil ? new Date(data.validUntil) : null,
        status: data.status ?? 1,
        remark: data.remark ?? null,
      },
    });
    created(res, item);
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const updateCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = certificateSchema.partial().parse(req.body);
    const update: Record<string, unknown> = { ...data };
    if (data.validUntil !== undefined) {
      update.validUntil = data.validUntil ? new Date(data.validUntil) : null;
    }
    await prisma.certificate.update({ where: { id: req.params.id }, data: update });
    success(res, null, '更新成功');
  } catch (err) {
    if (err instanceof z.ZodError) {
      fail(res, 400, err.errors.map((e) => e.message).join(', '));
      return;
    }
    fail(res, 500, '服务器错误');
  }
};

export const deleteCertificate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await prisma.certificate.delete({ where: { id: req.params.id } });
    success(res, null, '删除成功');
  } catch {
    fail(res, 500, '服务器错误');
  }
};
